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
//! triangle's longest edge over the cell size, at least 1 and at most [`MAX_RESOLUTION`]; the cell
//! grows until the scene keeps under its budget of samples. The samples hold what the renderer
//! shades (the RSB `WETP` section, `rt_core::weather`): when each was first wet, when the rain last
//! wiped its dust, how fast dust and snow pile on it.
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
//! the mesh drips there. A drip falls straight down to the first part under it and lands there as
//! a drop (it may splash again), or is gone. A porous material soaks its drops in at
//! `soak × π a²` mm³ per second.
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
use crate::world::{Transform, STEP, STEPS_PER_SECOND};
use rt_core::fmath;
use rt_core::math::{Aabb, Vec3};
use rt_core::rng::mix64;

/// The magic number of a `WPT1` spec.
pub const PARTS_MAGIC: &[u8; 4] = b"WPT1";
/// The version this reader understands.
pub const PARTS_VERSION: u32 = 1;
/// Most parts in a spec.
pub const MAX_PARTS: usize = 1024;
/// Most sources in a spec.
pub const MAX_SOURCES: usize = 64;
/// Most drops on all the parts together (◆: each is a cap the renderer meshes).
pub const MAX_PART_DROPS: usize = 4096;
/// Most steps of a triangle's grid of samples per side.
pub const MAX_RESOLUTION: u32 = 64;
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
// Salts of the counter hashes (fixed forever).
const SALT_STEP: u64 = 0x53c0_0000_0000_0001;
const SALT_COUNT: u64 = 0x53c0_0000_0000_0002;
const SALT_PLACE: u64 = 0x53c0_0000_0000_0003;
const SALT_SPLASH: u64 = 0x53c0_0000_0000_0004;
const SALT_FILM: u64 = 0x53c0_0000_0000_0005;

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
}

/// Everything the simulation of the parts is given (the `WPT1` bytes):
///
/// ```text
/// "WPT1"  u32 version (1); u32 seed; f32 cell_mm; u32 max_samples; f32 repose_deg snow_repose_deg;
/// u32 meshes; per mesh: u32 vertices indices; f32 positions[3 × vertices]; u32 indices[]
/// u32 parts; per part: u32 mesh; f32 rows[12] (the 3 × 4 object-to-world matrix by rows);
///            f32 advancing_deg receding_deg soak_mm_s; u32 flags (1: a film)
/// u32 sources; per source: u32 kind (0 drops, 1 dust, 2 snow); f32 density (per mm³);
///              f32 velocity[3] (world, mm/s); f32 size_mm size_var
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
        if version != PARTS_VERSION {
            return Err(format!("WPT1: version {version} is not {PARTS_VERSION}"));
        }
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
        let part_count = w.count(68)?;
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
        })
    }

    /// The `WPT1` bytes of this spec.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut words: Vec<u32> = vec![
            PARTS_VERSION,
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
    soak: f32,
    film: bool,
    to_object: Transform,
}

/// A drop on a part.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Drop {
    part: u32,
    tri: u32,
    p: Vec3,
    volume: f32,
    /// Its contact radius (of `volume` at its part's cap).
    a: f32,
    /// New or moved since the last merge: it may touch another.
    fresh: bool,
}

impl Drop {
    fn new(part: u32, tri: u32, p: Vec3, volume: f32, k: f32) -> Drop {
        Drop {
            part,
            tri,
            p,
            volume,
            a: cbrt(volume / k),
            fresh: true,
        }
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
        let mut order: Vec<u32> = (0..tris.len() as u32)
            .filter(|&i| tris[i as usize].area > 0.0)
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
    /// Down the slope of each triangle it is on.
    Downhill,
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
    moved: f32,
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
}

impl WetParts {
    /// Dry, clean parts under `spec`.
    pub fn new(spec: PartsSpec) -> WetParts {
        // The triangles, world space.
        let mut parts = Vec::with_capacity(spec.parts.len());
        let mut tris: Vec<Tri> = Vec::new();
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
            parts.push(Part {
                first_tri,
                tris: tris.len() as u32 - first_tri,
                first_sample: 0,
                samples: 0,
                k,
                hysteresis,
                sin_cap: fmath::sin(cap_deg * fmath::DEG_TO_RAD),
                cap_deg,
                soak: ps.soak_mm_s,
                film: ps.flags & PART_FILM != 0,
                to_object: inverse(&ps.transform),
            });
        }
        // The cell that keeps every triangle's grid under the budget.
        let longest = |t: &Tri| {
            let e = [t.v[1] - t.v[0], t.v[2] - t.v[1], t.v[0] - t.v[2]];
            e[0].length().max(e[1].length()).max(e[2].length())
        };
        let res_of = |t: &Tri, cell: f32| {
            let r = (longest(t) / cell).ceil();
            if r.is_nan() || r < 1.0 {
                1
            } else {
                (r as u32).min(MAX_RESOLUTION)
            }
        };
        let mut cell = spec.cell_mm;
        for _ in 0..200 {
            let total: u64 = tris
                .iter()
                .map(|t| u64::from(samples_of(res_of(t, cell))))
                .sum();
            if total <= u64::from(spec.max_samples) {
                break;
            }
            cell *= 1.25;
        }
        // The samples.
        let mut pos = Vec::new();
        let mut sample_tri = Vec::new();
        for (ti, t) in tris.iter_mut().enumerate() {
            t.res = res_of(t, cell);
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
        for p in parts.iter_mut() {
            p.first_sample = tris
                .get(p.first_tri as usize)
                .map_or(pos.len() as u32, |t| t.first);
            let end = tris
                .get((p.first_tri + p.tris) as usize)
                .map_or(pos.len() as u32, |t| t.first);
            p.samples = end - p.first_sample;
        }
        let n = pos.len();
        let tree = RayTree::build(&tris);
        let grid = SampleGrid::new(&pos, (2.0 * cell).max(4.0));
        let mut this = WetParts {
            steps: 0,
            cell,
            parts,
            tris,
            pos,
            sample_tri,
            wet: vec![NEVER; n],
            wiped: vec![0; n],
            dust_rate: vec![0.0; n],
            snow_rate: vec![0.0; n],
            has_dust: false,
            has_snow: false,
            grid,
            tree,
            sources: Vec::new(),
            drops: Vec::new(),
            film: Vec::new(),
            film_done: 0,
            new_wet: Vec::new(),
            new_wiped: Vec::new(),
            wiped_mark: vec![NEVER; n],
            frame_no: 0,
            drips_since: 0,
            landed: 0,
            splashes: 0,
            drips: 0,
            shed: 0.0,
            lost_water: 0.0,
            scratch: Vec::new(),
            dirty: false,
            spec,
        };
        this.prepare_sources();
        this
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
                        if !(cos > 0.0 && t.area > 0.0) || self.parts[t.part as usize].film {
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
                        let n = self.tris[self.sample_tri[smp as usize] as usize].n;
                        let cos = -dir.dot(n);
                        if !above(cos, 0.0) || n.z <= 0.0 {
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
        }
        self.film.sort_unstable();
    }

    /// True when nothing of the parts is in the way of sample `smp` upstream of `dir`.
    fn open(&self, smp: u32, dir: Vec3) -> bool {
        let n = self.tris[self.sample_tri[smp as usize] as usize].n;
        let origin = self.pos[smp as usize] + n * RAY_OFFSET;
        self.tree
            .cast(&self.tris, origin, -dir, f32::INFINITY, true, |_| true)
            .is_none()
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
            self.drops.push(Drop::new(part as u32, ti, p, volume, k));
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
        changed |= self.soak();
        changed |= self.slide();
        if changed && self.drops.len() > 1 {
            self.merge();
        }
    }

    /// The drops of source `si` that land in step `step`; true when one came.
    fn land(&mut self, step: u32, si: usize) -> bool {
        let lambda = self.sources[si].lambda;
        let total = self.sources[si].cdf.last().copied().unwrap_or(0.0);
        if !(lambda > 0.0 && total > 0.0) {
            return false;
        }
        let s = self.spec.sources[si];
        let speed = s.velocity.length();
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
            let state = &self.sources[si];
            let at = state
                .cdf
                .partition_point(|&c| c <= pick)
                .min(state.cdf.len() - 1);
            let ti = state.tris[at];
            let t = self.tris[ti as usize];
            let (r1, r2) = (draw().sqrt(), draw());
            let p = t.v[0] * (1.0 - r1) + t.v[1] * (r1 * (1.0 - r2)) + t.v[2] * (r1 * r2);
            let d = s.size_mm * (1.0 + var * (2.0 * draw() - 1.0)).max(0.05);
            let seed = h;
            // In the open, or something else of the scene took it first.
            let origin = p + t.n * RAY_OFFSET;
            if self
                .tree
                .cast(&self.tris, origin, -dir, f32::INFINITY, true, |_| true)
                .is_some()
            {
                continue;
            }
            self.landed += 1;
            let normal_speed = speed * (-dir.dot(t.n)).max(0.0);
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
            for n in 0..SPLASH_DROPS {
                let h = mix64(seed ^ SALT_SPLASH ^ u64::from(n));
                let angle = unit(h) * 2.0 * fmath::PI;
                let reach = d * (1.0 + (SPLASH_REACH - 1.0) * unit(mix64(h)));
                let (sa, ca) = fmath::sin_cos(angle);
                let dir = u_axis * ca + v_axis * sa;
                let end = self.walk(ti, p, Course::Straight(dir), reach, &mut Vec::new());
                if end.off || self.drops.len() >= MAX_PART_DROPS {
                    self.lost_water += each;
                    continue;
                }
                let drop = Drop::new(t.part, end.tri, end.p, each, self.parts[part_index].k);
                let n_end = self.tris[end.tri as usize].n;
                self.wet_disc(t.part, end.p, n_end, drop.a, false);
                self.drops.push(drop);
                added = true;
            }
        }
        if self.drops.len() < MAX_PART_DROPS {
            let k = self.parts[part_index].k;
            self.drops.push(Drop::new(t.part, ti, p, volume, k));
            added = true;
        } else {
            self.lost_water += volume;
        }
        added
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
            self.lost_water += lost;
            let n = self.tris[d.tri as usize].n;
            self.wet_disc(d.part, d.p, n, d.a, false);
            changed = true;
            gone |= left < MIN_VOLUME;
        }
        if gone {
            self.drops.retain(|d| d.volume >= MIN_VOLUME);
        }
        changed
    }

    /// Drops past their critical size slide down, hanging ones drip; true when one moved.
    fn slide(&mut self) -> bool {
        if self.drops.is_empty() {
            return false;
        }
        let gravity = Vec3::new(0.0, 0.0, -1.0);
        let mut moved = false;
        let mut keep = vec![true; self.drops.len()];
        let mut drips: Vec<(Vec3, f32)> = Vec::new();
        let mut path = Vec::new();
        for (i, kept) in keep.iter_mut().enumerate() {
            let d = self.drops[i];
            let part = self.parts[d.part as usize];
            let t = self.tris[d.tri as usize];
            let a = d.a;
            let gn = gravity.dot(t.n);
            // A drop on a face that looks down hangs until its weight beats its contact line.
            if gn > 0.0 {
                let pull = WATER_WEIGHT * d.volume * gn;
                let hold = PENDANT_HOLD * 2.0 * fmath::PI * a * SURFACE_TENSION * part.sin_cap;
                if pull > hold {
                    *kept = false;
                    drips.push((d.p + t.n * a, d.volume));
                    moved = true;
                    continue;
                }
            }
            let along = gravity - t.n * gn;
            let slope = along.length();
            if !above(slope, 1.0e-6) {
                continue;
            }
            // Furmidge: the weight along the face against the contact line's hold.
            let excess =
                WATER_WEIGHT * d.volume * slope - 2.0 * SURFACE_TENSION * part.hysteresis * a;
            if excess <= 0.0 {
                continue;
            }
            let speed = (excess / (SLIDE_DRAG * WATER_VISCOSITY * a)).min(MAX_SLIDE_SPEED);
            path.clear();
            path.push(d.p);
            let end = self.walk(d.tri, d.p, Course::Downhill, speed * STEP, &mut path);
            path.push(end.p);
            moved = true;
            // The film it leaves behind, and the dust it takes.
            let film = (TRAIL_FILM_MM * 2.0 * a * end.moved).min(d.volume);
            self.shed += film;
            let left = d.volume - film;
            for w in path.windows(2) {
                self.wipe(d.part, w[0], w[1], a, t.n);
            }
            if end.off {
                *kept = false;
                drips.push((end.p, left));
                continue;
            }
            if left < MIN_VOLUME {
                *kept = false;
                continue;
            }
            self.drops[i] = Drop {
                tri: end.tri,
                p: end.p,
                volume: left,
                a: cbrt(left / part.k),
                fresh: true,
                ..d
            };
        }
        if keep.iter().any(|k| !k) {
            let mut it = keep.iter();
            self.drops.retain(|_| *it.next().unwrap_or(&true));
        }
        for (p, volume) in drips {
            self.drip(p, volume);
        }
        moved
    }

    /// A drop of `volume` leaves the surface at `p` and falls: it lands on the first part below
    /// facing up, or is gone.
    fn drip(&mut self, p: Vec3, volume: f32) {
        self.drips += 1;
        self.drips_since += 1;
        let down = Vec3::new(0.0, 0.0, -1.0);
        let tris = &self.tris;
        let hit = self.tree.cast(tris, p, down, f32::INFINITY, false, |i| {
            tris[i as usize].n.z > 0.0
        });
        let Some((ti, fall)) = hit else {
            self.lost_water += volume;
            return;
        };
        let speed = (2.0 * GRAVITY_MM * fall).sqrt();
        let d = cbrt(6.0 * volume / fmath::PI);
        let at = p + down * fall;
        let seed = mix64(
            u64::from(self.spec.seed) ^ u64::from(self.steps) << 24 ^ u64::from(self.drips) << 48,
        );
        let t = self.tris[ti as usize];
        self.impact(ti, at, d, speed * t.n.z.max(0.0), seed);
    }

    /// Walks a point of triangle `ti` along the surface by `dist`, from triangle to triangle,
    /// appending the corners of its path (the edges it crosses) to `path`.
    fn walk(&self, ti: u32, p: Vec3, course: Course, dist: f32, path: &mut Vec<Vec3>) -> WalkEnd {
        let gravity = Vec3::new(0.0, 0.0, -1.0);
        let mut tri = ti;
        let mut p = p;
        let mut left = dist;
        let mut moved = 0.0f32;
        let mut stalls = 0;
        let dir_on = |t: &Tri| -> Option<Vec3> {
            let want = match course {
                Course::Downhill => gravity,
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
            if let (Course::Downhill, Some(false)) = (course, into) {
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

    /// Merges the drops of a part that touch into one of their volume at their centre of mass,
    /// until none touch. Only a drop that is new or moved since the last merge can touch another
    /// (the others were apart then), so each pass looks around those, in index order: the survivor
    /// takes the lower index and the place of the larger, moved along the surface towards the other;
    /// it is new again for the next pass.
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
                let reach = self.drops[i].a + largest;
                let pad = Vec3::new(reach, reach, reach);
                near.clear();
                grid.query(pos[i] - pad, pos[i] + pad, &mut near);
                near.sort_unstable();
                let mut other = None;
                for &j in near.iter() {
                    let j = j as usize;
                    if j == i || !alive[j] {
                        continue;
                    }
                    let (p, q) = (self.drops[i], self.drops[j]);
                    if p.part == q.part && (q.p - p.p).length() < p.a + q.a {
                        other = Some(j);
                        break;
                    }
                }
                let Some(j) = other else {
                    self.drops[i].fresh = false;
                    continue;
                };
                let (keep, gone) = (i.min(j), i.max(j));
                let (p, q) = (self.drops[keep], self.drops[gone]);
                let volume = p.volume + q.volume;
                let (big, small) = if q.volume > p.volume { (q, p) } else { (p, q) };
                let shift = (small.p - big.p) * (small.volume / volume);
                let n = self.tris[big.tri as usize].n;
                let tangent = shift - n * shift.dot(n);
                let len = tangent.length();
                let (tri, at) = if len > 1.0e-6 {
                    let end = self.walk(
                        big.tri,
                        big.p,
                        Course::Straight(tangent / len),
                        len,
                        &mut Vec::new(),
                    );
                    (end.tri, end.p)
                } else {
                    (big.tri, big.p)
                };
                let k = self.parts[p.part as usize].k;
                self.drops[keep] = Drop::new(p.part, tri, at, volume, k);
                alive[gone] = false;
                merged = true;
            }
            if merged {
                let mut it = alive.iter();
                self.drops.retain(|_| *it.next().unwrap_or(&true));
            }
        }
    }

    /// The layout of the samples, once per run: little-endian words
    ///
    /// ```text
    /// u32 parts; f32 cell_mm;
    /// per part: u32 triangles samples; u32 flags (1: dust rates follow, 2: snow rates follow);
    ///           f32 cap_angle_deg; u8 resolution[triangles], zero padding to 4;
    ///           [f32 dust_rate[samples] (per second)] [f32 snow_rate[samples] (mm per second)]
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
            word(p.tris, &mut out);
            word(p.samples, &mut out);
            word(u32::from(dust) | u32::from(snow) << 1, &mut out);
            word(p.cap_deg.to_bits(), &mut out);
            for t in &self.tris[p.first_tri as usize..(p.first_tri + p.tris) as usize] {
                out.push(t.res as u8);
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
        out
    }

    /// The record of a frame, and the start of the next one: little-endian words
    ///
    /// ```text
    /// u32 drops; per drop: u32 part triangle (its index in the part's mesh);
    ///            f32 x y z (the part's object space) a (contact radius, mm)
    /// u32 wetted; u32 samples[wetted]   (first wet since the last frame, ascending)
    /// u32 wiped;  u32 samples[wiped]    (wiped since the last frame, ascending)
    /// u32 drips                         (since the last frame)
    /// ```
    pub fn frame(&mut self) -> Vec<u8> {
        let mut words: Vec<u32> = Vec::with_capacity(
            4 + 6 * self.drops.len() + self.new_wet.len() + self.new_wiped.len(),
        );
        words.push(self.drops.len() as u32);
        for d in &self.drops {
            let part = &self.parts[d.part as usize];
            let o = part.to_object.apply(d.p);
            words.extend_from_slice(&[
                d.part,
                d.tri - part.first_tri,
                o.x.to_bits(),
                o.y.to_bits(),
                o.z.to_bits(),
                d.a.to_bits(),
            ]);
        }
        self.new_wet.sort_unstable();
        self.new_wiped.sort_unstable();
        words.push(self.new_wet.len() as u32);
        words.extend_from_slice(&self.new_wet);
        words.push(self.new_wiped.len() as u32);
        words.extend_from_slice(&self.new_wiped);
        words.push(self.drips_since);
        self.new_wet.clear();
        self.new_wiped.clear();
        self.drips_since = 0;
        self.frame_no += 1;
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    /// The parts as the renderer takes them now ([`Weather`]): per part its samples' wetness (0 or
    /// 1), share under dust and depth of snow, and its drops in its object space.
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
                        .map(|t| t.res as u8)
                        .collect(),
                    wet: (s0..s1).map(|s| self.wet[s] <= self.steps).collect(),
                    dust: (s0..s1).map(|s| self.dust_at(s)).collect(),
                    snow_mm: (s0..s1).map(|s| self.snow_at(s)).collect(),
                    cap_angle_deg: p.cap_deg,
                    drops: self
                        .drops
                        .iter()
                        .filter(|d| d.part as usize == pi)
                        .map(|d| (d.tri - p.first_tri, p.to_object.apply(d.p), d.a))
                        .collect(),
                }
            })
            .collect()
    }

    /// FNV-1a (32 bits) of the steps, the drops in order and every sample's wet and wiped steps:
    /// what the native and WebAssembly builds are compared by.
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
        }
        for (&w, &x) in self.wet.iter().zip(&self.wiped) {
            eat(w);
            eat(x);
        }
        for (&d, &s) in self.dust_rate.iter().zip(&self.snow_rate) {
            eat(d.to_bits());
            eat(s.to_bits());
        }
        h
    }
}

/// A part as the renderer takes it: the samples of each triangle (`resolution`, the order of
/// [`sample_index`]) and their state, its drops.
#[derive(Clone, Debug, PartialEq)]
pub struct Weather {
    /// The resolution of each triangle, in the mesh's order.
    pub resolution: Vec<u8>,
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

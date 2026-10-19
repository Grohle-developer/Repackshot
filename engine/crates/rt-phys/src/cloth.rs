//! Cloth (phase S9): a sheet of particles moved by extended position based dynamics, the method
//! of Macklin, Müller and Chentanez, "XPBD: Position-Based Simulation of Compliant Constrained
//! Dynamics" (MIG 2016), stepped as in Macklin, Storey, Lu, Terdiman, Chentanez, Jeschke and
//! Müller, "Small Steps in Physics Simulation" (SCA 2019): many substeps of few iterations each.
//! Implemented from the papers; no code from any physics library.
//!
//! **What is cloth.** Each piece is a triangle mesh in world millimetres (the face of a part, or
//! the shell of a solid), welded by exact position (the importers split the vertices along seams),
//! with a fabric's parameters: mass per area, stiffness against stretching along its threads and
//! against shearing between them, bending rigidity, damping and the thickness at which it
//! collides. Its vertices are particles of `mass per area × a third of the area of their
//! triangles`; an anchored vertex does not move.
//!
//! **Constraints**, every one in the compliant form of XPBD
//! (`Δλ = (−C − α̃λ) / (Σ wᵢ|∇ᵢC|² + α̃)`, `α̃ = α/h²`, the multiplier starting at zero in each
//! substep and accumulated over its [`CLOTH_ITERATIONS`] iterations):
//!
//! * **membrane**, orthotropic, per triangle, as in Müller, Chentanez, Kim and Macklin, "Strain
//!   Based Dynamics" (SCA 2014): the triangle's rest shape in the 2D coordinates of its warp and
//!   weft (the warp is the fabric's grain direction, world X unless the spec says otherwise,
//!   projected onto the triangle's rest plane; [`grain`]), the deformation gradient
//!   `F = [x₁ − x₀, x₂ − x₀] D⁻¹` and its columns `F_u` (along the warp) and `F_v` (the weft); three
//!   constraints: warp stretch `|F_u| − 1`, weft stretch `|F_v| − 1` and shear `F̂_u · F̂_v` (the
//!   cosine of the angle between the threads, normalised so that it does not stretch), with
//!   compliance `1 / (k A)` for the triangle's rest area `A` and a stiffness `k` (N/m): the
//!   stretch stiffness for the first two, the much lower shear stiffness of a woven fabric for
//!   the third (its threads scissor long before they stretch: what lets it drape over a dome in
//!   folds instead of creasing like paper);
//! * **bending**: every edge between two triangles keeps its rest dihedral angle,
//!   `C = θ − θ₀`, with `θ = atan2((n̂₁ × n̂₂)·ê, n̂₁·n̂₂)` (no `acos`: it is exact and stable when
//!   the sheet is flat) and the gradients of Bridson, Marino and Fedkiw, "Simulation of Clothing
//!   with Folds and Wrinkles" (SCA 2003); the stiffness has the form of the discrete shells of
//!   Grinspun, Hirani, Desbrun and Schröder (SCA 2003), `f B |e|² / (A₁ + A₂)` for a bending
//!   rigidity `B` (N·m), with the factor `f` ([`BEND_CALIBRATION`]) measured on a sheet of squares
//!   split along alternating diagonals: bent into a cylinder along its warp it stores `f` times the
//!   continuum's `½ B κ²` per area ([`Cloth::bending_energy`]), and a cantilever of it, its
//!   vertices free to settle, measures `B` with `f = 4/3` (Grinspun's `f = 3` is more than twice
//!   too stiff on it);
//! * **area** (optional): every triangle keeps its area, `C = |N| − |N₀|` with `N` twice its area
//!   vector, compliance `4 A₀ / K`;
//! * **pressure** (optional, a closed shell): the volume it encloses is `pressure × V₀`, one global
//!   constraint over its triangles (Müller et al., "Position Based Dynamics", VRIPHYS 2006).
//!
//! **Collisions** after the constraints of each substep, in this order: the cloth itself, particle
//! against particle within a self-collision distance through a spatial hash grid rebuilt every
//! step (Müller, "Ten Minute Physics"; pairs closer than that distance at rest are left out); the
//! dynamic bodies of the rigid [`World`] it runs with (a ball exactly; a hull by its farthest face
//! plane; one way: the bodies push the cloth, it does not push them); the floor; the static
//! triangles (a particle that went through a face in the substep goes back to the side it came
//! from, so a fast particle cannot tunnel through a thin wall; then out to its thickness from the
//! nearest point of the surface); and last the **sharp features** of the static parts and of the
//! hulls against the cloth's surface, so that a corner or a rim cannot poke through a cloth
//! triangle between its particles: every vertex of a feature against every cloth triangle
//! (point–triangle) and every edge of one against every cloth edge (edge–edge), each kept at the
//! cloth's thickness on the side it was on at the start of the substep (a feature that crossed the
//! cloth in the substep goes back), the cloth moving alone (the feature does not move) by its
//! barycentric weights and inverse masses. A feature edge is one where the surface folds by more
//! than [`FEATURE_ANGLE`], or by enough for a triangle of this cloth to dip into it by a tenth of
//! the thickness ([`FEATURE_DIP`]), or ends (an open rim); a feature vertex, an end of a feature
//! edge. The candidates of each step come from a hash grid of the cloth's triangles.
//! Friction is Coulomb's at the level of positions: the tangential motion of a contact in a
//! substep is cancelled while it is under `μ` times the depth it was pushed out, and cut by that
//! much otherwise.
//!
//! **Wind** (S4a): each triangle feels the drag of the air moving past it,
//! `½ ρ C_d A |vₙ| vₙ n̂` with `vₙ` the normal part of the wind relative to the triangle, the wind
//! being the scene's plus gusts from the divergence-free turbulence of the ambient effects
//! (`rt_sim::noise::curl`) at the triangle's centre, drifting with time.
//!
//! **Determinism.** `f32` with IEEE operations, `sqrt` and `fmath` only; every list is built in an
//! order that depends on the input alone (sorted edges, hash grids filled and read in element
//! order), so a run gives the same bits everywhere, natively and in WebAssembly, whatever the
//! number of threads the rigid world splits its narrow phase over; [`Cloth::hash`] is the check.

use crate::bvh::StaticMesh;
use crate::collide::closest_on_triangle;
use crate::math::above;
use crate::shape::Shape;
use crate::world::{World, GRAVITY, SLEEP_SECONDS, STEP};
use rt_core::fmath;
use rt_core::math::{Aabb, Vec3};
use std::collections::HashMap;

/// The magic number of a cloth spec.
pub const MAGIC: &[u8; 4] = b"CLT1";
/// The version this simulator writes; it reads this one and version 1 (without the shear and
/// the warp, which then read as [`V1_SHEAR_SHARE`] of the stretch and [`WARP`]).
pub const VERSION: u32 = 2;
/// A version 1 spec's shear stiffness, as a share of its stretch stiffness: that of an isotropic
/// sheet of Poisson's ratio 0.3, `1 / (2 (1 + ν))`, which is what that version's springs along
/// every edge (the diagonals too) amounted to.
pub const V1_SHEAR_SHARE: f32 = 1.0 / 2.6;
/// The warp direction of a fabric unless its spec gives one: world X.
pub const WARP: Vec3 = Vec3::new(1.0, 0.0, 0.0);
/// A triangle whose plane is within this angle of square to the warp direction (`|warp
/// projected| < sin` of it) takes as its warp the direction `Z × warp` projected instead (world Y
/// for the default warp).
pub const WARP_FALLBACK_DEG: f32 = 20.0;
/// A static edge where the surface folds by more than this (the angle between the normals of its
/// two triangles, degrees), or by more than [`FEATURE_DIP`] allows, or an edge of only one
/// triangle, is a sharp feature the cloth's surface collides with (not only its particles); so are
/// its two vertices.
pub const FEATURE_ANGLE: f32 = 10.0;
/// A cloth triangle of side `e` resting with its particles at the thickness `t` over a ridge that
/// folds by `φ` dips about `e φ / 4` towards it: a ridge is a feature too when that dip would pass
/// this share of the thinnest cloth's thickness, at the cloth's mean edge (`φ > 4 × share × t /
/// e`), so that a coarse cloth does not sink into a finely faceted curve either.
pub const FEATURE_DIP: f32 = 0.1;
/// Substeps per fixed step of [`STEP`] seconds.
pub const CLOTH_SUBSTEPS: u32 = 8;
/// Iterations of every constraint per substep. Bending is solved in each: with fewer, a stiff
/// fabric (a heavy leather on a sheet of 6 mm triangles) bends visibly more than its rigidity
/// says, the few iterations of XPBD leaving its constraints softer than their compliance.
pub const CLOTH_ITERATIONS: u32 = 2;
/// The factor on the discrete-shell bending stiffness `B |e|² / (A₁ + A₂)`: a sheet of squares
/// split along alternating diagonals bent into a cylinder along its warp stores `½ B κ²` per
/// area with the factor 1, but once its vertices settle (its squares fold a little along their
/// diagonals) it keeps three quarters of that; with `4 / 3` a cantilever of it measures `B`
/// (Peirce's test, `tests/cloth.rs`).
pub const BEND_CALIBRATION: f32 = 4.0 / 3.0;
/// `ClothParams::flags`: the piece collides with itself (and with the other pieces that do).
pub const FLAG_SELF_COLLISION: u32 = 1;
/// Density of air, kg/mm³.
pub const AIR_DENSITY: f32 = 1.2e-9;
/// Drag coefficient of a flat sheet across the flow.
pub const DRAG_COEFFICIENT: f32 = 1.0;
/// A cloth none of whose particles gets farther than this speed (mm/s) would take it in
/// [`SLEEP_SECONDS`], for that long, has settled.
pub const REST_SPEED: f32 = 6.0;
/// The self-collision distance is at least this share of the mean rest edge (two layers of a fold
/// cannot pass between the particles of each other).
pub const SELF_SPACING: f32 = 0.5;
/// Thinnest collision distance, mm.
pub const MIN_THICKNESS: f32 = 0.05;
/// The direction the gusts drift through their lattice (any fixed unit vector).
const GUST_DRIFT: Vec3 = Vec3::new(0.577_350_3, 0.577_350_3, 0.577_350_3);
/// Bending rigidity, N·m, in the simulator's kg·mm²/s².
const NM_TO_KG_MM2: f32 = 1.0e6;
/// Mass per area, kg/m², in kg/mm².
const PER_M2_TO_PER_MM2: f32 = 1.0e-6;

/// What a piece of cloth is made of.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClothParams {
    /// kg/m².
    pub mass_per_area: f32,
    /// Membrane stiffness against stretching along the warp and along the weft, N/m.
    pub stretch: f32,
    /// Membrane stiffness against shearing (the warp and the weft turning towards each other),
    /// N/m per radian.
    pub shear: f32,
    /// Bending rigidity, N·m.
    pub bend: f32,
    /// Damping of the particles' velocity, 1/s.
    pub damping: f32,
    /// The distance at which it collides, mm.
    pub thickness: f32,
    /// Coulomb friction against whatever it touches.
    pub friction: f32,
    /// Area stiffness, N/m (0: off).
    pub area: f32,
    /// A closed shell encloses this times its rest volume (0: no pressure).
    pub pressure: f32,
    /// The warp's direction, world (projected onto each triangle's rest plane; [`grain`]).
    pub warp: Vec3,
    /// [`FLAG_SELF_COLLISION`].
    pub flags: u32,
}

impl Default for ClothParams {
    fn default() -> ClothParams {
        ClothParams {
            mass_per_area: 0.15,
            stretch: 5000.0,
            shear: 50.0,
            bend: 1.0e-5,
            damping: 1.0,
            thickness: 1.0,
            friction: 0.5,
            area: 0.0,
            pressure: 0.0,
            warp: WARP,
            flags: FLAG_SELF_COLLISION,
        }
    }
}

/// A piece of cloth: its vertices (world, mm), its triangles, the anchored vertices.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClothPiece {
    /// Vertex positions, world mm.
    pub positions: Vec<Vec3>,
    /// Three per triangle.
    pub indices: Vec<u32>,
    /// One per vertex: it does not move.
    pub pinned: Vec<bool>,
    /// The fabric.
    pub params: ClothParams,
}

/// Static triangles the cloth collides with (world, mm).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClothStatic {
    /// Vertex positions.
    pub positions: Vec<Vec3>,
    /// Three per triangle.
    pub indices: Vec<u32>,
}

/// The wind of the scene.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClothWind {
    /// mm/s.
    pub velocity: Vec3,
    /// Gusts: the turbulence's velocity as a share of the wind's speed (0: steady).
    pub gust: f32,
    /// The size of a gust, mm.
    pub scale: f32,
    /// How fast the gusts change, mm/s.
    pub speed: f32,
    /// Their seed.
    pub seed: u32,
}

/// Everything the cloth simulator is given (`CLT1`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClothSpec {
    /// The pieces of cloth.
    pub pieces: Vec<ClothPiece>,
    /// The static parts.
    pub statics: Vec<ClothStatic>,
    /// The floor: height (mm) and friction.
    pub floor: Option<(f32, f32)>,
    /// The wind.
    pub wind: ClothWind,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn word(&mut self) -> Result<[u8; 4], String> {
        let end = self.at + 4;
        let w = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| format!("CLT1: cut short at byte {}", self.at))?;
        self.at = end;
        Ok([w[0], w[1], w[2], w[3]])
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.word()?))
    }
    fn f32(&mut self) -> Result<f32, String> {
        let v = f32::from_le_bytes(self.word()?);
        if v.is_finite() {
            Ok(v)
        } else {
            Err(format!(
                "CLT1: a value that is not finite at byte {}",
                self.at - 4
            ))
        }
    }
    fn vec3(&mut self) -> Result<Vec3, String> {
        Ok(Vec3::new(self.f32()?, self.f32()?, self.f32()?))
    }
    /// A count of items of `bytes` each that must fit in what is left.
    fn count(&mut self, bytes: usize) -> Result<usize, String> {
        let n = self.u32()? as usize;
        if n.saturating_mul(bytes) > self.bytes.len() - self.at {
            return Err(format!("CLT1: a count of {n} does not fit in the file"));
        }
        Ok(n)
    }
    /// A mesh: vertices, indices, positions, indices.
    fn mesh(&mut self) -> Result<(Vec<Vec3>, Vec<u32>), String> {
        let nv = self.count(12)?;
        let ni = self.u32()? as usize;
        let mut positions = Vec::with_capacity(nv);
        for _ in 0..nv {
            positions.push(self.vec3()?);
        }
        if !ni.is_multiple_of(3) || ni.saturating_mul(4) > self.bytes.len() - self.at {
            return Err("CLT1: an index count that does not fit".into());
        }
        let mut indices = Vec::with_capacity(ni);
        for _ in 0..ni {
            let i = self.u32()?;
            if i as usize >= nv {
                return Err(format!("CLT1: index {i} of a mesh of {nv} vertices"));
            }
            indices.push(i);
        }
        Ok((positions, indices))
    }
}

fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_f32(out: &mut Vec<u8>, v: f32) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_mesh(out: &mut Vec<u8>, positions: &[Vec3], indices: &[u32]) {
    put_u32(out, positions.len() as u32);
    put_u32(out, indices.len() as u32);
    for p in positions {
        put_f32(out, p.x);
        put_f32(out, p.y);
        put_f32(out, p.z);
    }
    for &i in indices {
        put_u32(out, i);
    }
}

impl ClothSpec {
    /// Reads a `CLT1` spec:
    ///
    /// ```text
    /// "CLT1"  u32 version (2; 1 is read too)
    /// u32 pieces; per piece: u32 vertices, u32 indices, f32 positions[3 × vertices] (world mm),
    ///         u32 indices[], u32 pinned[⌈vertices / 32⌉] (bit v % 32 of word v / 32),
    ///         f32 mass per area (kg/m²), stretch (N/m), shear (N/m; not in version 1),
    ///         bend (N·m), damping (1/s), thickness (mm), friction, area (N/m, 0 off),
    ///         pressure (0 off), warp[3] (world; not in version 1); u32 flags
    /// u32 statics; per static: u32 vertices, u32 indices, f32 positions[], u32 indices[]
    /// u32 floor (0 none, 1 yes), f32 z, f32 friction
    /// f32 wind[3] (mm/s), f32 gust, f32 gust scale (mm), f32 gust speed (mm/s), u32 seed
    /// ```
    pub fn parse(bytes: &[u8]) -> Result<ClothSpec, String> {
        let mut r = Reader { bytes, at: 0 };
        if r.word()? != *MAGIC {
            return Err("CLT1: not a cloth spec".into());
        }
        let version = r.u32()?;
        if version != VERSION && version != 1 {
            return Err(format!(
                "CLT1: version {version}, this simulator reads 1 and {VERSION}"
            ));
        }
        let mut spec = ClothSpec::default();
        let pieces = r.count(8)?;
        for _ in 0..pieces {
            let (positions, indices) = r.mesh()?;
            let words = positions.len().div_ceil(32);
            if words.saturating_mul(4) > bytes.len() - r.at {
                return Err("CLT1: the anchors do not fit".into());
            }
            let mut pinned = vec![false; positions.len()];
            for w in 0..words {
                let bits = r.u32()?;
                for b in 0..32 {
                    if let Some(p) = pinned.get_mut(w * 32 + b) {
                        *p = bits & (1 << b) != 0;
                    }
                }
            }
            let (mass_per_area, stretch) = (r.f32()?, r.f32()?);
            let shear = if version == 1 {
                stretch * V1_SHEAR_SHARE
            } else {
                r.f32()?
            };
            let (bend, damping, thickness, friction) = (r.f32()?, r.f32()?, r.f32()?, r.f32()?);
            let (area, pressure) = (r.f32()?, r.f32()?);
            let warp = if version == 1 { WARP } else { r.vec3()? };
            let params = ClothParams {
                mass_per_area,
                stretch,
                shear,
                bend,
                damping,
                thickness,
                friction,
                area,
                pressure,
                warp,
                flags: r.u32()?,
            };
            spec.pieces.push(ClothPiece {
                positions,
                indices,
                pinned,
                params,
            });
        }
        let statics = r.count(8)?;
        for _ in 0..statics {
            let (positions, indices) = r.mesh()?;
            spec.statics.push(ClothStatic { positions, indices });
        }
        let floor = r.u32()?;
        let (z, friction) = (r.f32()?, r.f32()?);
        if floor == 1 {
            spec.floor = Some((z, friction));
        }
        spec.wind = ClothWind {
            velocity: r.vec3()?,
            gust: r.f32()?,
            scale: r.f32()?,
            speed: r.f32()?,
            seed: r.u32()?,
        };
        if r.at != bytes.len() {
            return Err(format!("CLT1: {} bytes after the end", bytes.len() - r.at));
        }
        Ok(spec)
    }

    /// The `CLT1` bytes of the spec ([`ClothSpec::parse`] reads them back).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        put_u32(&mut out, VERSION);
        put_u32(&mut out, self.pieces.len() as u32);
        for p in &self.pieces {
            put_mesh(&mut out, &p.positions, &p.indices);
            for w in 0..p.positions.len().div_ceil(32) {
                let mut bits = 0u32;
                for b in 0..32 {
                    if p.pinned.get(w * 32 + b).copied().unwrap_or(false) {
                        bits |= 1 << b;
                    }
                }
                put_u32(&mut out, bits);
            }
            let q = &p.params;
            for v in [
                q.mass_per_area,
                q.stretch,
                q.shear,
                q.bend,
                q.damping,
                q.thickness,
                q.friction,
                q.area,
                q.pressure,
                q.warp.x,
                q.warp.y,
                q.warp.z,
            ] {
                put_f32(&mut out, v);
            }
            put_u32(&mut out, q.flags);
        }
        put_u32(&mut out, self.statics.len() as u32);
        for s in &self.statics {
            put_mesh(&mut out, &s.positions, &s.indices);
        }
        let (on, z, f) = match self.floor {
            Some((z, f)) => (1, z, f),
            None => (0, 0.0, 0.0),
        };
        put_u32(&mut out, on);
        put_f32(&mut out, z);
        put_f32(&mut out, f);
        let w = &self.wind;
        for v in [
            w.velocity.x,
            w.velocity.y,
            w.velocity.z,
            w.gust,
            w.scale,
            w.speed,
        ] {
            put_f32(&mut out, v);
        }
        put_u32(&mut out, w.seed);
        out
    }
}

/// The orthotropic membrane of one triangle (Strain Based Dynamics).
#[derive(Clone, Copy, Debug)]
struct Membrane {
    tri: [u32; 3],
    /// The inverse of the rest shape `D = [p₁ − p₀, p₂ − p₀]` in the triangle's warp and weft
    /// coordinates, row by row: `F_u = (x₁ − x₀) m₀₀ + (x₂ − x₀) m₁₀`, `F_v = (x₁ − x₀) m₀₁ +
    /// (x₂ − x₀) m₁₁`.
    inv: [f32; 4],
    /// Compliance of the warp, the weft and the shear, `1 / (k A)`.
    compliance: [f32; 3],
    /// The multipliers, accumulated over the iterations of a substep.
    lambda: [f32; 3],
}

#[derive(Clone, Copy, Debug)]
struct Bend {
    /// The shared edge, in the winding of the first triangle.
    x0: u32,
    x1: u32,
    /// The wing of the first triangle, and of the second.
    x2: u32,
    x3: u32,
    rest: f32,
    /// The angle when last solved, followed through ±π (a fold that closes past flat, the cloth
    /// passing through itself, keeps pushing back the same way instead of flipping).
    angle: f32,
    compliance: f32,
    lambda: f32,
}

#[derive(Clone, Copy, Debug)]
struct AreaConstraint {
    tri: u32,
    rest: f32,
    compliance: f32,
    lambda: f32,
}

#[derive(Clone, Debug)]
struct Volume {
    /// The triangles of the shell.
    tris: Vec<u32>,
    target: f32,
}

/// The signed dihedral angle at edge `x0 x1` between the triangles `(x0, x1, x2)` and
/// `(x1, x0, x3)`, and its gradients with respect to the four points (zero for a degenerate
/// triangle).
pub fn dihedral(x0: Vec3, x1: Vec3, x2: Vec3, x3: Vec3) -> (f32, [Vec3; 4]) {
    let e = x1 - x0;
    let l2 = e.length_squared();
    let n1 = e.cross(x2 - x0);
    let n2 = (x0 - x1).cross(x3 - x1);
    let (m1, m2) = (n1.length_squared(), n2.length_squared());
    if !(above(l2, 0.0) && above(m1, 0.0) && above(m2, 0.0)) {
        return (0.0, [Vec3::ZERO; 4]);
    }
    let l = l2.sqrt();
    let (u1, u2) = (n1 * (1.0 / m1.sqrt()), n2 * (1.0 / m2.sqrt()));
    let theta = fmath::atan2(u1.cross(u2).dot(e) / l, u1.dot(u2));
    let g2 = n1 * (-l / m1);
    let g3 = n2 * (-l / m2);
    let a2 = (x2 - x0).dot(e) / l2;
    let a3 = (x3 - x0).dot(e) / l2;
    let g0 = g2 * -(1.0 - a2) - g3 * (1.0 - a3);
    let g1 = g2 * -a2 - g3 * a3;
    (theta, [g0, g1, g2, g3])
}

/// The warp and weft directions of a triangle of unit normal `n` for a fabric whose warp runs along
/// `warp` (world): `warp` projected onto the triangle's plane, or, when the plane is within
/// [`WARP_FALLBACK_DEG`] of square to it, `Z × warp` projected (world Y for the default warp X;
/// world X for a warp along Z); the weft is `n × warp`. Both unit and in the plane.
pub fn grain(n: Vec3, warp: Vec3) -> (Vec3, Vec3) {
    let d = if above(warp.length_squared(), 0.0) {
        warp.normalize()
    } else {
        WARP
    };
    let mut u = d - n * n.dot(d);
    let (s, _) = fmath::sin_cos(WARP_FALLBACK_DEG.to_radians());
    if u.length_squared() < s * s {
        let z = Vec3::new(0.0, 0.0, 1.0).cross(d);
        let alt = if above(z.length_squared(), 1.0e-6) {
            z
        } else {
            WARP
        };
        u = alt - n * n.dot(alt);
    }
    let u = if above(u.length_squared(), 0.0) {
        u.normalize()
    } else {
        // Only for a degenerate normal: any direction will do.
        WARP
    };
    (u, n.cross(u))
}

/// The angle `a` brought into (−π, π].
fn wrap(a: f32) -> f32 {
    let pi = std::f32::consts::PI;
    if a > pi {
        a - 2.0 * pi
    } else if a <= -pi {
        a + 2.0 * pi
    } else {
        a
    }
}

/// Where along `from → to` (0..1) the segment passes through the triangle `v` of unit normal `n`
/// (edges included within a micrometre), starting at signed distance `before` from its plane; none
/// when it does not.
fn crossing(from: Vec3, to: Vec3, v: &[Vec3; 3], n: Vec3, before: f32) -> Option<f32> {
    let after = (to - v[0]).dot(n);
    if (before >= 0.0) == (after >= 0.0) {
        return None;
    }
    let span = before - after;
    if !above(span.abs(), 0.0) {
        return None;
    }
    let t = before / span;
    let x = from + (to - from) * t;
    ((closest_on_triangle(x, v[0], v[1], v[2]) - x).length() <= 1.0e-3).then_some(t)
}

/// Appends to `verts` and `edges` the sharp features of a static mesh: its edges where the surface
/// folds by more than `fold` radians (the angle between the normals of the two triangles), or that
/// belong to one triangle or to more than two, and the vertices at their ends. The mesh is welded
/// by exact position first (the importers split vertices along seams), in index order.
pub fn sharp_features(
    positions: &[Vec3],
    indices: &[u32],
    fold: f32,
    verts: &mut Vec<Vec3>,
    edges: &mut Vec<[Vec3; 2]>,
) {
    let mut weld: HashMap<[u32; 3], u32> = HashMap::new();
    let mut points: Vec<Vec3> = Vec::new();
    let mut id = Vec::with_capacity(positions.len());
    for &p in positions {
        if !p.is_finite() {
            id.push(u32::MAX);
            continue;
        }
        let next = points.len() as u32;
        let i = *weld.entry(key(p)).or_insert(next);
        if i == next {
            points.push(p);
        }
        id.push(i);
    }
    let mut tris: Vec<([u32; 3], Vec3)> = Vec::new();
    for t in indices.chunks_exact(3) {
        let Some(ids) = t
            .iter()
            .map(|&v| id.get(v as usize).copied().filter(|i| *i != u32::MAX))
            .collect::<Option<Vec<u32>>>()
        else {
            continue;
        };
        let ids = [ids[0], ids[1], ids[2]];
        if ids[0] == ids[1] || ids[1] == ids[2] || ids[0] == ids[2] {
            continue;
        }
        let [a, b, c] = ids.map(|i| points[i as usize]);
        let n = (b - a).cross(c - a);
        if !above(n.length(), 0.0) {
            continue;
        }
        tris.push((ids, n.normalize()));
    }
    // (low, high, triangle, whether the triangle runs low → high).
    let mut sides: Vec<(u32, u32, u32, bool)> = Vec::with_capacity(tris.len() * 3);
    for (k, (t, _)) in tris.iter().enumerate() {
        for s in 0..3 {
            let (a, b) = (t[s], t[(s + 1) % 3]);
            sides.push((a.min(b), a.max(b), k as u32, a < b));
        }
    }
    sides.sort_unstable();
    let (sin_half, cos_half) = fmath::sin_cos(0.5 * fold);
    let cos_fold = cos_half * cos_half - sin_half * sin_half;
    let mut corner = vec![false; points.len()];
    let mut i = 0;
    while i < sides.len() {
        let mut j = i + 1;
        while j < sides.len() && sides[j].0 == sides[i].0 && sides[j].1 == sides[i].1 {
            j += 1;
        }
        let sharp = if j - i == 2 {
            let (n1, n2) = (tris[sides[i].2 as usize].1, tris[sides[i + 1].2 as usize].1);
            // Wound the same way along the edge, one of them is the other way round.
            let n2 = if sides[i].3 == sides[i + 1].3 {
                -n2
            } else {
                n2
            };
            n1.dot(n2) < cos_fold
        } else {
            true
        };
        if sharp {
            let (a, b) = (sides[i].0, sides[i].1);
            edges.push([points[a as usize], points[b as usize]]);
            corner[a as usize] = true;
            corner[b as usize] = true;
        }
        i = j;
    }
    for (p, c) in points.iter().zip(&corner) {
        if *c {
            verts.push(*p);
        }
    }
}

/// The parameters `(s, t)` of the closest points of the lines `p₀ + s (p₁ − p₀)` and
/// `q₀ + t (q₁ − q₀)`, and the unit normal `(p₁ − p₀) × (q₁ − q₀)`; none when they are within a
/// degree of parallel (or a segment has no length).
fn line_closest(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3) -> Option<(f32, f32, Vec3)> {
    let (d1, d2, r) = (p1 - p0, q1 - q0, p0 - q0);
    let n = d1.cross(d2);
    let (a, e) = (d1.length_squared(), d2.length_squared());
    let nn = n.length_squared();
    // sin² of the angle between them under (1°)².
    if !(above(a, 0.0) && above(e, 0.0)) || nn < 3.0e-4 * a * e {
        return None;
    }
    let (b, c, f) = (d1.dot(d2), d1.dot(r), d2.dot(r));
    let den = a * e - b * b;
    let s = (b * f - c * e) / den;
    let t = (a * f - b * c) / den;
    Some((s, t, n * (1.0 / nn.sqrt())))
}

fn contains(b: &Aabb, p: Vec3) -> bool {
    b.min.x <= p.x
        && p.x <= b.max.x
        && b.min.y <= p.y
        && p.y <= b.max.y
        && b.min.z <= p.z
        && p.z <= b.max.z
}

fn overlap(a: &Aabb, b: &Aabb) -> bool {
    a.min.x <= b.max.x
        && b.min.x <= a.max.x
        && a.min.y <= b.max.y
        && b.min.y <= a.max.y
        && a.min.z <= b.max.z
        && b.min.z <= a.max.z
}

/// Weld key of a position: its bits (with −0 as +0).
fn key(p: Vec3) -> [u32; 3] {
    [
        (p.x + 0.0).to_bits(),
        (p.y + 0.0).to_bits(),
        (p.z + 0.0).to_bits(),
    ]
}

/// The simulation.
pub struct Cloth {
    x: Vec<Vec3>,
    prev: Vec<Vec3>,
    v: Vec<Vec3>,
    /// Inverse mass (0: anchored or massless).
    w: Vec<f32>,
    /// Where each particle started (pairs closer than the self-collision distance there are left
    /// out of it).
    rest: Vec<Vec3>,
    thickness: Vec<f32>,
    friction: Vec<f32>,
    damping: Vec<f32>,
    /// Self-collision distance of each particle (0: it does not collide with the cloth).
    self_dist: Vec<f32>,
    piece_of: Vec<u32>,
    /// For each vertex of each piece, in order, its particle.
    vertex_particle: Vec<u32>,
    tris: Vec<[u32; 3]>,
    /// The edges of the cloth, once each (lower particle first), and the three of each triangle.
    edges: Vec<[u32; 2]>,
    tri_edges: Vec<[u32; 3]>,
    membrane: Vec<Membrane>,
    bend: Vec<Bend>,
    area: Vec<AreaConstraint>,
    volumes: Vec<Volume>,
    statics: StaticMesh,
    /// The sharp features of the static parts (world mm): vertices and edges.
    static_verts: Vec<Vec3>,
    static_edges: Vec<[Vec3; 2]>,
    /// The features of this step: the static ones and those of the hulls, each with the body it
    /// belongs to (`u32::MAX`: static).
    feat_verts: Vec<(Vec3, u32)>,
    feat_edges: Vec<([Vec3; 2], u32)>,
    /// (feature vertex, cloth triangle) and (feature edge, cloth edge) pairs that may touch in
    /// this step.
    vf: Vec<(u32, u32)>,
    ee: Vec<(u32, u32)>,
    floor: Option<(f32, f32)>,
    wind: ClothWind,
    /// The wind each triangle feels in this step (mm/s).
    tri_wind: Vec<Vec3>,
    /// The change of velocity the air gives each particle in a substep.
    gusts: Vec<Vec3>,
    steps: u64,
    still: f32,
    /// Where the particles were when the current window of stillness began.
    window: Vec<Vec3>,
    /// Per particle, its candidate static triangles of this step (CSR).
    cand_start: Vec<u32>,
    cand: Vec<u32>,
    /// (particle, body) pairs that may touch in this step.
    body_cand: Vec<(u32, u32)>,
    /// (particle, particle, distance) pairs that may touch in this step.
    pairs: Vec<(u32, u32, f32)>,
    query: Vec<u32>,
}

impl Cloth {
    /// Builds the cloth of a spec.
    pub fn new(spec: &ClothSpec) -> Cloth {
        let mut c = Cloth {
            x: Vec::new(),
            prev: Vec::new(),
            v: Vec::new(),
            w: Vec::new(),
            rest: Vec::new(),
            thickness: Vec::new(),
            friction: Vec::new(),
            damping: Vec::new(),
            self_dist: Vec::new(),
            piece_of: Vec::new(),
            vertex_particle: Vec::new(),
            tris: Vec::new(),
            edges: Vec::new(),
            tri_edges: Vec::new(),
            membrane: Vec::new(),
            bend: Vec::new(),
            area: Vec::new(),
            volumes: Vec::new(),
            statics: StaticMesh::default(),
            static_verts: Vec::new(),
            static_edges: Vec::new(),
            feat_verts: Vec::new(),
            feat_edges: Vec::new(),
            vf: Vec::new(),
            ee: Vec::new(),
            floor: spec.floor,
            wind: spec.wind,
            tri_wind: Vec::new(),
            gusts: Vec::new(),
            steps: 0,
            still: 0.0,
            window: Vec::new(),
            cand_start: Vec::new(),
            cand: Vec::new(),
            body_cand: Vec::new(),
            pairs: Vec::new(),
            query: Vec::new(),
        };
        for (k, piece) in spec.pieces.iter().enumerate() {
            c.add_piece(k as u32, piece);
        }
        let fold = c.feature_fold();
        for s in &spec.statics {
            c.statics.add(&s.positions, &s.indices, 0.5, 0.0);
            sharp_features(
                &s.positions,
                &s.indices,
                fold,
                &mut c.static_verts,
                &mut c.static_edges,
            );
        }
        c.tri_wind = vec![Vec3::ZERO; c.tris.len()];
        c
    }

    fn add_piece(&mut self, k: u32, piece: &ClothPiece) {
        let p = &piece.params;
        let first = self.x.len() as u32;
        let mut weld: HashMap<[u32; 3], u32> = HashMap::new();
        let mut pinned: Vec<bool> = Vec::new();
        for (i, &pos) in piece.positions.iter().enumerate() {
            let finite = pos.is_finite();
            let at = if finite {
                weld.get(&key(pos)).copied()
            } else {
                None
            };
            let id = match at {
                Some(id) => id,
                None => {
                    let id = self.x.len() as u32;
                    let pos = if finite { pos } else { Vec3::ZERO };
                    self.x.push(pos);
                    self.rest.push(pos);
                    self.piece_of.push(k);
                    pinned.push(false);
                    if finite {
                        weld.insert(key(pos), id);
                    }
                    id
                }
            };
            if piece.pinned.get(i).copied().unwrap_or(false) || !finite {
                pinned[(id - first) as usize] = true;
            }
            self.vertex_particle.push(id);
        }
        let count = self.x.len() - first as usize;
        let mut mass = vec![0.0f32; count];
        let mut tris: Vec<[u32; 3]> = Vec::new();
        let base = self.vertex_particle.len() - piece.positions.len();
        for t in piece.indices.chunks_exact(3) {
            let ids = [t[0], t[1], t[2]].map(|v| self.vertex_particle[base + v as usize]);
            if ids[0] == ids[1] || ids[1] == ids[2] || ids[0] == ids[2] {
                continue;
            }
            let [a, b, cc] = ids.map(|i| self.x[i as usize]);
            let area = 0.5 * (b - a).cross(cc - a).length();
            if !above(area, 0.0) {
                continue;
            }
            for i in ids {
                mass[(i - first) as usize] += area / 3.0 * p.mass_per_area * PER_M2_TO_PER_MM2;
            }
            tris.push(ids);
        }
        let thickness = p.thickness.max(MIN_THICKNESS);
        for (i, m) in mass.iter().enumerate() {
            self.w.push(if pinned[i] || !above(*m, 0.0) {
                0.0
            } else {
                1.0 / m
            });
            self.thickness.push(thickness);
            self.friction.push(p.friction.max(0.0));
            self.damping.push(p.damping.max(0.0));
        }
        // The membrane of each triangle, in its rest frame of warp and weft.
        let stiff = p.stretch.max(1.0e-6);
        let shear = p.shear.max(1.0e-6);
        let tri_area = |t: &[u32; 3], x: &[Vec3]| {
            let [a, b, c] = t.map(|i| x[i as usize]);
            0.5 * (b - a).cross(c - a).length()
        };
        for t in &tris {
            let [x0, x1, x2] = t.map(|i| self.x[i as usize]);
            let nn = (x1 - x0).cross(x2 - x0);
            let a = 0.5 * nn.length();
            let (u, v) = grain(nn.normalize(), p.warp);
            let (e1, e2) = (x1 - x0, x2 - x0);
            let (p1, p2) = ((e1.dot(u), e1.dot(v)), (e2.dot(u), e2.dot(v)));
            let det = p1.0 * p2.1 - p2.0 * p1.1;
            if !above(det.abs(), 0.0) {
                continue;
            }
            let inv = [p2.1 / det, -p2.0 / det, -p1.1 / det, p1.0 / det];
            self.membrane.push(Membrane {
                tri: *t,
                inv,
                compliance: [1.0 / (stiff * a), 1.0 / (stiff * a), 1.0 / (shear * a)],
                lambda: [0.0; 3],
            });
        }
        // The edges, sorted, with the triangles on each side.
        let tri0 = self.tris.len() as u32;
        let mut edges: Vec<(u32, u32, u32, u32)> = Vec::with_capacity(tris.len() * 3);
        for (ti, t) in tris.iter().enumerate() {
            for s in 0..3 {
                let (a, b, o) = (t[s], t[(s + 1) % 3], t[(s + 2) % 3]);
                edges.push((a.min(b), a.max(b), tri0 + ti as u32, o));
            }
        }
        edges.sort_unstable();
        let bend = p.bend.max(0.0) * NM_TO_KG_MM2;
        let mut tri_edges = vec![[u32::MAX; 3]; tris.len()];
        let mut closed = !edges.is_empty();
        let mut rest_sum = 0.0f32;
        let mut rest_n = 0u32;
        let mut i = 0;
        while i < edges.len() {
            let mut j = i + 1;
            while j < edges.len() && edges[j].0 == edges[i].0 && edges[j].1 == edges[i].1 {
                j += 1;
            }
            let (a, b) = (edges[i].0, edges[i].1);
            let id = self.edges.len() as u32;
            self.edges.push([a, b]);
            for e in &edges[i..j] {
                let slots = &mut tri_edges[(e.2 - tri0) as usize];
                if let Some(s) = slots.iter_mut().find(|s| **s == u32::MAX) {
                    *s = id;
                }
            }
            let rest = (self.x[a as usize] - self.x[b as usize]).length();
            rest_sum += rest;
            rest_n += 1;
            if j - i != 2 {
                closed = false;
            }
            if j - i == 2 && bend > 0.0 {
                let (e1, e2) = (edges[i], edges[i + 1]);
                let t1 = tris[(e1.2 - tri0) as usize];
                // The edge as the first triangle winds it.
                let forward = (0..3).any(|s| t1[s] == a && t1[(s + 1) % 3] == b);
                let (x0, x1) = if forward { (a, b) } else { (b, a) };
                let (x2, x3) = (e1.3, e2.3);
                let pos = |i: u32| self.x[i as usize];
                let (theta, _) = dihedral(pos(x0), pos(x1), pos(x2), pos(x3));
                let areas =
                    tri_area(&t1, &self.x) + tri_area(&tris[(e2.2 - tri0) as usize], &self.x);
                let k_theta = BEND_CALIBRATION * bend * rest * rest / areas.max(1.0e-12);
                self.bend.push(Bend {
                    x0,
                    x1,
                    x2,
                    x3,
                    rest: theta,
                    angle: theta,
                    compliance: 1.0 / k_theta.max(1.0e-30),
                    lambda: 0.0,
                });
            }
            i = j;
        }
        self.tri_edges.extend_from_slice(&tri_edges);
        if p.area > 0.0 {
            for (ti, t) in tris.iter().enumerate() {
                let a0 = tri_area(t, &self.x);
                self.area.push(AreaConstraint {
                    tri: tri0 + ti as u32,
                    rest: 2.0 * a0,
                    compliance: 4.0 * a0 / p.area,
                    lambda: 0.0,
                });
            }
        }
        let mean = if rest_n > 0 {
            rest_sum / rest_n as f32
        } else {
            0.0
        };
        let self_dist = if p.flags & FLAG_SELF_COLLISION != 0 {
            thickness.max(SELF_SPACING * mean)
        } else {
            0.0
        };
        self.self_dist.extend(std::iter::repeat_n(self_dist, count));
        self.tris.extend_from_slice(&tris);
        if closed && p.pressure > 0.0 {
            let ids: Vec<u32> = (tri0..tri0 + tris.len() as u32).collect();
            let v0 = self.volume_of(&ids);
            if above(v0.abs(), 0.0) {
                self.volumes.push(Volume {
                    tris: ids,
                    target: p.pressure * v0,
                });
            }
        }
    }

    /// The fold (radians) beyond which a static edge is a feature for this cloth:
    /// [`FEATURE_ANGLE`], or less for a thin cloth of long edges ([`FEATURE_DIP`]).
    fn feature_fold(&self) -> f32 {
        let thinnest = self.thickness.iter().fold(f32::INFINITY, |m, t| m.min(*t));
        let mut sum = 0.0f32;
        for [a, b] in &self.edges {
            sum += (self.rest[*a as usize] - self.rest[*b as usize]).length();
        }
        let mean = sum / self.edges.len().max(1) as f32;
        let dip = if above(mean, 0.0) && thinnest.is_finite() {
            4.0 * FEATURE_DIP * thinnest / mean
        } else {
            f32::INFINITY
        };
        FEATURE_ANGLE.to_radians().min(dip)
    }

    fn volume_of(&self, tris: &[u32]) -> f32 {
        let o = self.x[self.tris[tris[0] as usize][0] as usize];
        let mut v = 0.0f32;
        for &t in tris {
            let [a, b, c] = self.tris[t as usize].map(|i| self.x[i as usize] - o);
            v += a.cross(b).dot(c);
        }
        v / 6.0
    }

    /// Particles (the vertices once welded).
    pub fn particle_count(&self) -> usize {
        self.x.len()
    }

    /// Vertices of all the pieces, in order (the length of [`Cloth::positions`] over 3).
    pub fn vertex_count(&self) -> usize {
        self.vertex_particle.len()
    }

    /// Steps simulated.
    pub fn steps(&self) -> u64 {
        self.steps
    }

    /// No particle has got farther than [`REST_SPEED`] would take it for [`SLEEP_SECONDS`].
    pub fn settled(&self) -> bool {
        self.still >= SLEEP_SECONDS
    }

    /// Every vertex of every piece in order, world mm, x y z each.
    pub fn positions(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.vertex_particle.len() * 3);
        for &p in &self.vertex_particle {
            let x = self.x[p as usize];
            out.extend_from_slice(&[x.x, x.y, x.z]);
        }
        out
    }

    /// Particle `i` now.
    pub fn particle(&self, i: usize) -> Vec3 {
        self.x[i]
    }

    /// The particle of vertex `v` of all the pieces in order.
    pub fn particle_of_vertex(&self, v: usize) -> usize {
        self.vertex_particle[v] as usize
    }

    /// The triangles over the particles.
    pub fn triangles(&self) -> &[[u32; 3]] {
        &self.tris
    }

    /// The bending energy the cloth's hinges store with its particles at `x` (one per particle),
    /// kg·mm²/s² (µJ): `Σ ½ (θ − θ₀)² / α`.
    pub fn bending_energy(&self, x: &[Vec3]) -> f32 {
        let mut e = 0.0f32;
        for c in &self.bend {
            let p = |i: u32| x[i as usize];
            let (theta, _) = dihedral(p(c.x0), p(c.x1), p(c.x2), p(c.x3));
            let d = wrap(theta - c.rest);
            e += 0.5 * d * d / c.compliance;
        }
        e
    }

    /// The membrane energy the cloth's triangles store with its particles at `x`, kg·mm²/s²:
    /// `Σ ½ C² / α` over the warp, weft and shear of each.
    pub fn membrane_energy(&self, x: &[Vec3]) -> f32 {
        let mut e = 0.0f32;
        for c in &self.membrane {
            let [x0, x1, x2] = c.tri.map(|i| x[i as usize]);
            let [m00, m01, m10, m11] = c.inv;
            let (e1, e2) = (x1 - x0, x2 - x0);
            let (fu, fv) = (e1 * m00 + e2 * m10, e1 * m01 + e2 * m11);
            let (lu, lv) = (fu.length(), fv.length());
            if !(above(lu, 0.0) && above(lv, 0.0)) {
                continue;
            }
            let cs = fu.dot(fv) / (lu * lv);
            for (value, compliance) in [
                (lu - 1.0, c.compliance[0]),
                (lv - 1.0, c.compliance[1]),
                (cs, c.compliance[2]),
            ] {
                e += 0.5 * value * value / compliance;
            }
        }
        e
    }

    /// FNV-1a (32 bits) over the little-endian bytes of every particle's position.
    pub fn hash(&self) -> u32 {
        let mut h: u32 = 0x811c_9dc5;
        for p in &self.x {
            for v in [p.x, p.y, p.z] {
                for byte in v.to_le_bytes() {
                    h ^= byte as u32;
                    h = h.wrapping_mul(0x0100_0193);
                }
            }
        }
        h
    }

    /// Simulates `n` steps of [`STEP`] seconds; with a rigid world, it steps too, one step ahead
    /// of the cloth each time (the cloth meets the bodies where they are at the end of the step).
    pub fn step(&mut self, n: u32, mut world: Option<&mut World>) {
        for _ in 0..n {
            if let Some(w) = world.as_deref_mut() {
                w.step(1);
            }
            self.step_once(world.as_deref());
        }
    }

    fn step_once(&mut self, world: Option<&World>) {
        self.steps += 1;
        let n = self.x.len();
        if n == 0 {
            self.still += STEP;
            return;
        }
        self.gather(world);
        self.winds();
        let h = STEP / CLOTH_SUBSTEPS as f32;
        let g = Vec3::new(0.0, 0.0, -GRAVITY);
        for _ in 0..CLOTH_SUBSTEPS {
            self.wind_impulses(h);
            for i in 0..n {
                self.prev[i] = self.x[i];
                if self.w[i] == 0.0 {
                    self.v[i] = Vec3::ZERO;
                    continue;
                }
                let mut v = self.v[i] + g * h + self.gusts[i];
                v *= (1.0 - self.damping[i] * h).max(0.0);
                self.v[i] = v;
                self.x[i] += v * h;
            }
            let alpha = 1.0 / (h * h);
            for c in self.membrane.iter_mut() {
                c.lambda = [0.0; 3];
            }
            for c in self.bend.iter_mut() {
                c.lambda = 0.0;
            }
            for c in self.area.iter_mut() {
                c.lambda = 0.0;
            }
            for _ in 0..CLOTH_ITERATIONS {
                self.solve_membrane(alpha);
                self.solve_bend(alpha);
                self.solve_area(alpha);
                self.solve_volumes();
            }
            // The cloth against itself first and the static world last: what nothing can move has the
            // last word, so nothing the cloth does pushes a particle into it.
            self.collide_self();
            if let Some(w) = world {
                self.collide_bodies(w, h);
            }
            self.collide_floor();
            self.collide_statics();
            self.collide_features(world, h);
            let inv = 1.0 / h;
            for i in 0..n {
                if self.w[i] == 0.0 {
                    continue;
                }
                self.v[i] = (self.x[i] - self.prev[i]) * inv;
            }
        }
        self.track_stillness();
    }

    /// Still: no particle has got farther than its rest speed would take it since the window began
    /// (the jitter of a resting contact goes back and forth and gets nowhere).
    fn track_stillness(&mut self) {
        if self.window.len() != self.x.len() {
            self.window = self.x.clone();
            self.still = 0.0;
            return;
        }
        let reach = REST_SPEED * SLEEP_SECONDS;
        let moved = self
            .x
            .iter()
            .zip(&self.window)
            .any(|(x, w)| (*x - *w).length_squared() > reach * reach);
        if moved {
            self.window.copy_from_slice(&self.x);
            self.still = 0.0;
        } else {
            self.still += STEP;
        }
    }

    /// What each particle may touch in this step: static triangles, bodies, other particles.
    fn gather(&mut self, world: Option<&World>) {
        let n = self.x.len();
        if self.prev.len() != n {
            self.prev = self.x.clone();
            self.v = vec![Vec3::ZERO; n];
        }
        let reach = |c: &Cloth, i: usize| {
            c.v[i].length() * STEP * 1.5 + GRAVITY * STEP * STEP + c.thickness[i] + 1.0
        };
        self.cand_start.clear();
        self.cand.clear();
        for i in 0..n {
            self.cand_start.push(self.cand.len() as u32);
            if self.w[i] == 0.0 || self.statics.is_empty() {
                continue;
            }
            let r = reach(self, i);
            let p = self.x[i];
            let b = Aabb::new(p - Vec3::splat(r), p + Vec3::splat(r));
            self.query.clear();
            self.statics.query(&b, &mut self.query);
            self.query.sort_unstable();
            self.cand.extend_from_slice(&self.query);
        }
        self.cand_start.push(self.cand.len() as u32);
        self.body_cand.clear();
        if let Some(world) = world {
            for b in 0..world.body_count() as u32 {
                let Some(c) = world.collider(b) else { continue };
                let travel = c.velocity.length() * STEP + c.spin.length() * c.radius * STEP;
                for i in 0..n {
                    if self.w[i] == 0.0 {
                        continue;
                    }
                    let r = c.radius + travel + reach(self, i);
                    if (self.x[i] - c.center).length_squared() < r * r {
                        self.body_cand.push((i as u32, b));
                    }
                }
            }
            self.body_cand.sort_unstable();
        }
        self.gather_pairs();
        self.gather_features(world);
    }

    /// The features of this step (the static ones and the hulls' where they are now) and the
    /// cloth triangles and edges each may touch: the moving triangles, each in a box that holds its
    /// particles' reach in the step, in a hash grid of cells as big as the biggest box (by the
    /// cell of its low corner); a feature vertex looks in the eight cells below it, a feature edge,
    /// cut in pieces no longer than a cell, in the 27 around the low corner of each.
    fn gather_features(&mut self, world: Option<&World>) {
        self.feat_verts.clear();
        self.feat_edges.clear();
        self.vf.clear();
        self.ee.clear();
        self.feat_verts
            .extend(self.static_verts.iter().map(|p| (*p, u32::MAX)));
        self.feat_edges
            .extend(self.static_edges.iter().map(|e| (*e, u32::MAX)));
        if let Some(world) = world {
            for b in 0..world.body_count() as u32 {
                let Some(c) = world.collider(b) else { continue };
                let Shape::Hull(hull) = c.shape else {
                    continue;
                };
                let at = |v: Vec3| c.center + c.rotation.rotate(v);
                self.feat_verts
                    .extend(hull.vertices.iter().map(|v| (at(*v), b)));
                for e in &hull.edges {
                    let (a, z) = (hull.vertices[e.a as usize], hull.vertices[e.b as usize]);
                    self.feat_edges.push(([at(a), at(z)], b));
                }
            }
        }
        if self.feat_verts.is_empty() && self.feat_edges.is_empty() {
            return;
        }
        let reach = |c: &Cloth, i: usize| {
            c.v[i].length() * STEP * 1.5 + GRAVITY * STEP * STEP + c.thickness[i] + 1.0
        };
        let mut boxes: Vec<(u32, Aabb)> = Vec::new();
        let mut size = 0.0f32;
        let mut all = Aabb::EMPTY;
        for (k, t) in self.tris.iter().enumerate() {
            if t.iter().all(|&i| self.w[i as usize] == 0.0) {
                continue;
            }
            let mut b = Aabb::EMPTY;
            for &i in t {
                let (p, r) = (self.x[i as usize], reach(self, i as usize));
                b = b.union(Aabb::new(p - Vec3::splat(r), p + Vec3::splat(r)));
            }
            let e = b.max - b.min;
            size = size.max(e.x).max(e.y).max(e.z);
            all = all.union(b);
            boxes.push((k as u32, b));
        }
        if boxes.is_empty() || !(size.is_finite() && above(size, 0.0)) {
            return;
        }
        let table = (2 * boxes.len()).next_power_of_two();
        let cell = |p: Vec3| {
            [
                (p.x / size).floor() as i32,
                (p.y / size).floor() as i32,
                (p.z / size).floor() as i32,
            ]
        };
        let slot = |c: [i32; 3]| {
            let h = (c[0] as u32).wrapping_mul(92_837_111)
                ^ (c[1] as u32).wrapping_mul(689_287_499)
                ^ (c[2] as u32).wrapping_mul(283_923_481);
            (h as usize) & (table - 1)
        };
        let slots: Vec<usize> = boxes.iter().map(|(_, b)| slot(cell(b.min))).collect();
        let mut start = vec![0u32; table + 1];
        for &sl in &slots {
            start[sl + 1] += 1;
        }
        for k in 0..table {
            start[k + 1] += start[k];
        }
        let mut fill = start.clone();
        let mut cells = vec![0u32; boxes.len()];
        for (k, &sl) in slots.iter().enumerate() {
            cells[fill[sl] as usize] = k as u32;
            fill[sl] += 1;
        }
        let around = |c: [i32; 3], lo: i32, near: &mut Vec<u32>| {
            for dx in lo..=1 {
                for dy in lo..=1 {
                    for dz in lo..=1 {
                        let sl = slot([c[0] + dx, c[1] + dy, c[2] + dz]);
                        near.extend_from_slice(&cells[start[sl] as usize..start[sl + 1] as usize]);
                    }
                }
            }
        };
        let mut near: Vec<u32> = Vec::new();
        for (fv, &(p, _)) in self.feat_verts.iter().enumerate() {
            if !contains(&all, p) {
                continue;
            }
            near.clear();
            let c = cell(p);
            for dx in -1..=0 {
                for dy in -1..=0 {
                    for dz in -1..=0 {
                        let sl = slot([c[0] + dx, c[1] + dy, c[2] + dz]);
                        near.extend_from_slice(&cells[start[sl] as usize..start[sl + 1] as usize]);
                    }
                }
            }
            near.sort_unstable();
            near.dedup();
            for &k in &near {
                let (t, b) = boxes[k as usize];
                if contains(&b, p) {
                    self.vf.push((fv as u32, t));
                }
            }
        }
        for (fe, &([a, z], _)) in self.feat_edges.iter().enumerate() {
            if !overlap(&all, &Aabb::new(a.min(z), a.max(z))) {
                continue;
            }
            let pieces = (((z - a).length() / size).ceil() as u32).clamp(1, 1 << 16);
            near.clear();
            for k in 0..pieces {
                let p0 = a + (z - a) * (k as f32 / pieces as f32);
                let p1 = a + (z - a) * ((k + 1) as f32 / pieces as f32);
                let piece = Aabb::new(p0.min(p1), p0.max(p1));
                if !overlap(&all, &piece) {
                    continue;
                }
                let first = near.len();
                around(cell(piece.min), -1, &mut near);
                // Only the boxes that meet this piece.
                let mut keep = first;
                for q in first..near.len() {
                    let k = near[q];
                    if overlap(&boxes[k as usize].1, &piece) {
                        near[keep] = k;
                        keep += 1;
                    }
                }
                near.truncate(keep);
            }
            near.sort_unstable();
            near.dedup();
            for &k in &near {
                let t = boxes[k as usize].0;
                for &e in &self.tri_edges[t as usize] {
                    if e != u32::MAX {
                        self.ee.push((fe as u32, e));
                    }
                }
            }
        }
        self.vf.sort_unstable();
        self.vf.dedup();
        self.ee.sort_unstable();
        self.ee.dedup();
    }

    /// The self-collision pairs of this step, through a hash grid of the particles.
    fn gather_pairs(&mut self) {
        self.pairs.clear();
        let n = self.x.len();
        let mut cell = 0.0f32;
        let mut fastest = 0.0f32;
        for i in 0..n {
            cell = cell.max(self.self_dist[i]);
            fastest = fastest.max(self.v[i].length());
        }
        if !above(cell, 0.0) {
            return;
        }
        let margin = 2.0 * fastest * STEP;
        let size = cell + margin;
        let table = (2 * n).next_power_of_two();
        let coord = |p: Vec3| {
            [
                (p.x / size).floor() as i32,
                (p.y / size).floor() as i32,
                (p.z / size).floor() as i32,
            ]
        };
        let slot = |c: [i32; 3]| {
            let h = (c[0] as u32).wrapping_mul(92_837_111)
                ^ (c[1] as u32).wrapping_mul(689_287_499)
                ^ (c[2] as u32).wrapping_mul(283_923_481);
            (h as usize) & (table - 1)
        };
        // Counting sort of the particles into the slots, in particle order.
        let mut start = vec![0u32; table + 1];
        let slots: Vec<usize> = (0..n).map(|i| slot(coord(self.x[i]))).collect();
        for (i, &s) in slots.iter().enumerate() {
            if self.self_dist[i] > 0.0 {
                start[s + 1] += 1;
            }
        }
        for s in 0..table {
            start[s + 1] += start[s];
        }
        let mut fill = start.clone();
        let mut cells = vec![0u32; start[table] as usize];
        for (i, &s) in slots.iter().enumerate() {
            if self.self_dist[i] > 0.0 {
                cells[fill[s] as usize] = i as u32;
                fill[s] += 1;
            }
        }
        let mut near: Vec<u32> = Vec::new();
        for i in 0..n {
            let di = self.self_dist[i];
            if di <= 0.0 {
                continue;
            }
            let c = coord(self.x[i]);
            near.clear();
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for dz in -1..=1 {
                        let s = slot([c[0] + dx, c[1] + dy, c[2] + dz]);
                        for &j in &cells[start[s] as usize..start[s + 1] as usize] {
                            if j as usize > i {
                                near.push(j);
                            }
                        }
                    }
                }
            }
            near.sort_unstable();
            near.dedup();
            for &j in &near {
                let ju = j as usize;
                if self.w[i] == 0.0 && self.w[ju] == 0.0 {
                    continue;
                }
                let d = di.max(self.self_dist[ju]);
                let reach = d + margin;
                if (self.x[i] - self.x[ju]).length_squared() >= reach * reach {
                    continue;
                }
                // Close at rest: neighbours of the same piece, which the membrane keeps apart.
                if self.piece_of[i] == self.piece_of[ju]
                    && (self.rest[i] - self.rest[ju]).length_squared() < d * d
                {
                    continue;
                }
                self.pairs.push((i as u32, j, d));
            }
        }
    }

    /// The wind of each triangle in this step: the scene's, with its gusts.
    fn winds(&mut self) {
        let w = self.wind;
        let speed = w.velocity.length();
        let t = self.steps as f32 * STEP;
        let gusts = above(w.gust, 0.0) && above(w.scale, 0.0) && above(speed, 0.0);
        let seed = u64::from(w.seed) ^ 0xC107_4000_0000_0000;
        let drift = GUST_DRIFT * (w.speed * t / w.scale.max(1.0e-6));
        for (k, tri) in self.tris.iter().enumerate() {
            let mut v = w.velocity;
            if gusts {
                let [a, b, c] = tri.map(|i| self.x[i as usize]);
                let q = (a + b + c) * (1.0 / (3.0 * w.scale)) + drift;
                let d = rt_sim::noise::curl(seed, [q.x, q.y, q.z]);
                v += Vec3::new(d[0], d[1], d[2]) * (w.gust * speed);
            }
            self.tri_wind[k] = v;
        }
    }

    /// The change of velocity the air gives each particle over a substep of `h`.
    fn wind_impulses(&mut self, h: f32) {
        self.gusts.clear();
        self.gusts.resize(self.x.len(), Vec3::ZERO);
        if self.wind.velocity == Vec3::ZERO {
            return;
        }
        for (k, tri) in self.tris.iter().enumerate() {
            let [a, b, c] = tri.map(|i| self.x[i as usize]);
            let n = (b - a).cross(c - a);
            let len = n.length();
            if !above(len, 0.0) {
                continue;
            }
            let nh = n * (1.0 / len);
            let vel = (self.v[tri[0] as usize] + self.v[tri[1] as usize] + self.v[tri[2] as usize])
                * (1.0 / 3.0);
            let vn = (self.tri_wind[k] - vel).dot(nh);
            let f = nh * (0.5 * AIR_DENSITY * DRAG_COEFFICIENT * 0.5 * len * vn.abs() * vn);
            for &i in tri {
                self.gusts[i as usize] += f * (self.w[i as usize] * h / 3.0);
            }
        }
    }

    /// The membrane's three constraints of each triangle in turn: warp, weft, shear.
    fn solve_membrane(&mut self, alpha: f32) {
        for k in 0..self.membrane.len() {
            let c = self.membrane[k];
            let ids = c.tri.map(|i| i as usize);
            let ws = ids.map(|i| self.w[i]);
            if ws[0] + ws[1] + ws[2] == 0.0 {
                continue;
            }
            let [m00, m01, m10, m11] = c.inv;
            for j in 0..3 {
                let x0 = self.x[ids[0]];
                let (e1, e2) = (self.x[ids[1]] - x0, self.x[ids[2]] - x0);
                let (fu, fv) = (e1 * m00 + e2 * m10, e1 * m01 + e2 * m11);
                let (lu, lv) = (fu.length(), fv.length());
                if !(above(lu, 0.0) && above(lv, 0.0)) {
                    break;
                }
                let (uh, vh) = (fu * (1.0 / lu), fv * (1.0 / lv));
                let (value, g1, g2) = match j {
                    0 => (lu - 1.0, uh * m00, uh * m10),
                    1 => (lv - 1.0, vh * m01, vh * m11),
                    _ => {
                        let cs = uh.dot(vh);
                        let du = (vh - uh * cs) * (1.0 / lu);
                        let dv = (uh - vh * cs) * (1.0 / lv);
                        (cs, du * m00 + dv * m01, du * m10 + dv * m11)
                    }
                };
                let g = [-(g1 + g2), g1, g2];
                let at = c.compliance[j] * alpha;
                let mut sum = at;
                for q in 0..3 {
                    sum += ws[q] * g[q].length_squared();
                }
                if !above(sum, 0.0) {
                    continue;
                }
                let dl = (-value - at * self.membrane[k].lambda[j]) / sum;
                self.membrane[k].lambda[j] += dl;
                for q in 0..3 {
                    self.x[ids[q]] += g[q] * (dl * ws[q]);
                }
            }
        }
    }

    fn solve_bend(&mut self, alpha: f32) {
        for k in 0..self.bend.len() {
            let c = self.bend[k];
            let ids = [c.x0, c.x1, c.x2, c.x3].map(|i| i as usize);
            let ws = ids.map(|i| self.w[i]);
            if ws.iter().all(|w| *w == 0.0) {
                continue;
            }
            let (theta, g) = dihedral(
                self.x[ids[0]],
                self.x[ids[1]],
                self.x[ids[2]],
                self.x[ids[3]],
            );
            let at = c.compliance * alpha;
            let mut sum = at;
            for j in 0..4 {
                sum += ws[j] * g[j].length_squared();
            }
            if !above(sum, 0.0) {
                continue;
            }
            let angle = c.angle + wrap(theta - c.angle);
            self.bend[k].angle = angle;
            let dl = (-(angle - c.rest) - at * c.lambda) / sum;
            self.bend[k].lambda += dl;
            for j in 0..4 {
                self.x[ids[j]] += g[j] * (dl * ws[j]);
            }
        }
    }

    fn solve_area(&mut self, alpha: f32) {
        for k in 0..self.area.len() {
            let c = self.area[k];
            let ids = self.tris[c.tri as usize].map(|i| i as usize);
            let [p0, p1, p2] = ids.map(|i| self.x[i]);
            let nn = (p1 - p0).cross(p2 - p0);
            let len = nn.length();
            if !above(len, 0.0) {
                continue;
            }
            let nh = nn * (1.0 / len);
            let g1 = (p2 - p0).cross(nh);
            let g2 = nh.cross(p1 - p0);
            let g = [-(g1 + g2), g1, g2];
            let ws = ids.map(|i| self.w[i]);
            let at = c.compliance * alpha;
            let mut sum = at;
            for j in 0..3 {
                sum += ws[j] * g[j].length_squared();
            }
            if !above(sum, 0.0) {
                continue;
            }
            let dl = (-(len - c.rest) - at * c.lambda) / sum;
            self.area[k].lambda += dl;
            for j in 0..3 {
                self.x[ids[j]] += g[j] * (dl * ws[j]);
            }
        }
    }

    fn solve_volumes(&mut self) {
        for k in 0..self.volumes.len() {
            let tris = std::mem::take(&mut self.volumes[k].tris);
            let target = self.volumes[k].target;
            let o = self.x[self.tris[tris[0] as usize][0] as usize];
            let mut grad: HashMap<u32, Vec3> = HashMap::new();
            let mut order: Vec<u32> = Vec::new();
            let mut v = 0.0f32;
            for &t in &tris {
                let ids = self.tris[t as usize];
                let [a, b, c] = ids.map(|i| self.x[i as usize] - o);
                v += a.cross(b).dot(c);
                for (i, g) in [
                    (ids[0], b.cross(c)),
                    (ids[1], c.cross(a)),
                    (ids[2], a.cross(b)),
                ] {
                    let e = grad.entry(i).or_insert_with(|| {
                        order.push(i);
                        Vec3::ZERO
                    });
                    *e += g * (1.0 / 6.0);
                }
            }
            v /= 6.0;
            let mut sum = 0.0f32;
            for &i in &order {
                sum += self.w[i as usize] * grad[&i].length_squared();
            }
            if above(sum, 0.0) {
                let dl = -(v - target) / sum;
                for &i in &order {
                    let wi = self.w[i as usize];
                    self.x[i as usize] += grad[&i] * (dl * wi);
                }
            }
            self.volumes[k].tris = tris;
        }
    }

    /// Pushes particle `i` out by `depth` along the unit `n` and applies friction against a
    /// surface moving `surface` mm in this substep.
    fn contact(&mut self, i: usize, n: Vec3, depth: f32, surface: Vec3, mu: f32) {
        self.x[i] += n * depth;
        if !above(mu, 0.0) {
            return;
        }
        let d = (self.x[i] - self.prev[i]) - surface;
        let t = d - n * d.dot(n);
        let tl = t.length();
        if !above(tl, 0.0) {
            return;
        }
        let k = if tl <= mu * depth {
            1.0
        } else {
            mu * depth / tl
        };
        self.x[i] -= t * k;
    }

    fn collide_floor(&mut self) {
        let Some((z, mu)) = self.floor else { return };
        for i in 0..self.x.len() {
            if self.w[i] == 0.0 {
                continue;
            }
            let lo = z + self.thickness[i];
            if self.x[i].z < lo {
                // Between two surfaces, the geometric mean of their frictions (as the bodies).
                let f = (self.friction[i] * mu.max(0.0)).sqrt();
                self.contact(i, Vec3::new(0.0, 0.0, 1.0), lo - self.x[i].z, Vec3::ZERO, f);
            }
        }
    }

    /// Each particle against the static triangles: first back through the face it went through in
    /// this substep, if any (the first one along its way), to its thickness on the side it came
    /// from; then out to its thickness from the nearest point of the surface: one contact per
    /// particle, so the faces around a vertex or an edge of the surface do not each push it their
    /// own way (the side of a face's plane says nothing beyond the face's own edges).
    fn collide_statics(&mut self) {
        for i in 0..self.x.len() {
            if self.w[i] == 0.0 || self.cand_start[i] == self.cand_start[i + 1] {
                continue;
            }
            let th = self.thickness[i];
            let from = self.prev[i];
            let range = self.cand_start[i] as usize..self.cand_start[i + 1] as usize;
            // Through a face: the first crossing along the way.
            let mut first: Option<(f32, Vec3, Vec3)> = None;
            for &k in &self.cand[range.clone()] {
                let tri = self.statics.tri(k as usize);
                let before = (from - tri.v[0]).dot(tri.n);
                if let Some(t) = crossing(from, self.x[i], &tri.v, tri.n, before) {
                    if first.is_none_or(|f| t < f.0) {
                        let side = if before >= 0.0 { tri.n } else { -tri.n };
                        first = Some((t, side, tri.v[0]));
                    }
                }
            }
            if let Some((_, side, v0)) = first {
                let plane = (self.x[i] - v0).dot(side);
                self.contact(i, side, th - plane, Vec3::ZERO, self.friction[i]);
            }
            // The nearest point of the surface.
            let p = self.x[i];
            let mut best: Option<(f32, Vec3, Vec3)> = None;
            for &k in &self.cand[range] {
                let tri = self.statics.tri(k as usize);
                let q = closest_on_triangle(p, tri.v[0], tri.v[1], tri.v[2]);
                let d2 = (p - q).length_squared();
                if best.is_none_or(|b| d2 < b.0) {
                    let side = if (from - tri.v[0]).dot(tri.n) >= 0.0 {
                        tri.n
                    } else {
                        -tri.n
                    };
                    best = Some((d2, q, side));
                }
            }
            let Some((d2, q, side)) = best else { continue };
            // Out from the nearest point (the crossings above leave the particle on its side of every
            // face); on the surface itself, out along the side it came from.
            let dist = d2.sqrt();
            let (n, depth) = if !above(dist, 1.0e-6) {
                (side, th)
            } else if dist < th {
                ((p - q) * (1.0 / dist), th - dist)
            } else {
                continue;
            };
            if above(depth, 0.0) {
                self.contact(i, n, depth, Vec3::ZERO, self.friction[i]);
            }
        }
    }

    /// Friction at a contact point that is the combination `bary` of the particles `ids`, pushed
    /// `depth` along the unit `n`, against a surface that moved `surface` in this substep: as
    /// [`Cloth::contact`]'s, the tangential correction shared by weight and inverse mass.
    fn friction_at(&mut self, ids: &[usize], bary: &[f32], n: Vec3, depth: f32, surface: Vec3) {
        let mut mu = 0.0f32;
        let mut d = Vec3::ZERO;
        let mut sum = 0.0f32;
        for (j, &i) in ids.iter().enumerate() {
            d += (self.x[i] - self.prev[i]) * bary[j];
            sum += self.w[i] * bary[j] * bary[j];
            mu = mu.max(self.friction[i]);
        }
        if !(above(mu, 0.0) && above(sum, 0.0)) {
            return;
        }
        let d = d - surface;
        let t = d - n * d.dot(n);
        let tl = t.length();
        if !above(tl, 0.0) {
            return;
        }
        let k = if tl <= mu * depth {
            1.0
        } else {
            mu * depth / tl
        };
        for (j, &i) in ids.iter().enumerate() {
            self.x[i] -= t * (k * self.w[i] * bary[j] / sum);
        }
    }

    /// How far the surface of body `body` (`u32::MAX`: static) moves at `p` in a substep of `h`.
    fn feature_motion(world: Option<&World>, body: u32, p: Vec3, h: f32) -> Vec3 {
        match world.and_then(|w| w.collider(body)) {
            Some(c) if body != u32::MAX => (c.velocity + c.spin.cross(p - c.center)) * h,
            _ => Vec3::ZERO,
        }
    }

    /// The sharp features against the cloth's surface: each feature vertex out of each cloth
    /// triangle it is over (within the triangle), each feature edge out of each cloth edge it
    /// passes (within both), to the thickness on the side it was at the start of the substep;
    /// an edge that crossed is put back only if it passed within both at the start too (else it
    /// went round an end, which the vertex there answers for).
    fn collide_features(&mut self, world: Option<&World>, h: f32) {
        for k in 0..self.vf.len() {
            let (fv, t) = self.vf[k];
            let (p, body) = self.feat_verts[fv as usize];
            let ids = self.tris[t as usize].map(|i| i as usize);
            let ws = ids.map(|i| self.w[i]);
            let [a0, b0, c0] = ids.map(|i| self.prev[i]);
            let n0 = (b0 - a0).cross(c0 - a0);
            if !above(n0.length_squared(), 0.0) {
                continue;
            }
            let side = if (p - a0).dot(n0) >= 0.0 { 1.0 } else { -1.0 };
            let [a, b, c] = ids.map(|i| self.x[i]);
            let n = (b - a).cross(c - a);
            let nl = n.length();
            if !above(nl, 0.0) || n.dot(n0) <= 0.0 {
                continue;
            }
            let n = n * (1.0 / nl);
            let th = ids.iter().fold(0.0f32, |m, &i| m.max(self.thickness[i]));
            let d = side * (p - a).dot(n);
            if d >= th {
                continue;
            }
            let (e1, e2, q) = (b - a, c - a, p - a);
            let (d00, d01, d11) = (e1.dot(e1), e1.dot(e2), e2.dot(e2));
            let (d20, d21) = (q.dot(e1), q.dot(e2));
            let den = d00 * d11 - d01 * d01;
            if !above(den, 0.0) {
                continue;
            }
            let v = (d11 * d20 - d01 * d21) / den;
            let w = (d00 * d21 - d01 * d20) / den;
            let bary = [1.0 - v - w, v, w];
            if bary.iter().any(|x| *x < 0.0) {
                continue;
            }
            let sum: f32 = (0..3).map(|j| ws[j] * bary[j] * bary[j]).sum();
            if !above(sum, 0.0) {
                continue;
            }
            // The cloth goes away from the feature.
            let dir = n * -side;
            let depth = th - d;
            for j in 0..3 {
                self.x[ids[j]] += dir * (ws[j] * bary[j] * depth / sum);
            }
            let surface = Self::feature_motion(world, body, p, h);
            self.friction_at(&ids, &bary, dir, depth, surface);
        }
        for k in 0..self.ee.len() {
            let (fe, e) = self.ee[k];
            let ([q0, q1], body) = self.feat_edges[fe as usize];
            let [ia, ib] = self.edges[e as usize].map(|i| i as usize);
            let (wa, wb) = (self.w[ia], self.w[ib]);
            if wa + wb == 0.0 {
                continue;
            }
            let (pa0, pb0) = (self.prev[ia], self.prev[ib]);
            let Some((s0, t0, n0)) = line_closest(pa0, pb0, q0, q1) else {
                continue;
            };
            let unit = |x: f32| (0.0..=1.0).contains(&x);
            let within = unit(s0) && unit(t0);
            let off = ((pa0 + (pb0 - pa0) * s0) - (q0 + (q1 - q0) * t0)).dot(n0);
            let side = if off >= 0.0 { 1.0 } else { -1.0 };
            let (pa, pb) = (self.x[ia], self.x[ib]);
            let Some((s1, t1, n1)) = line_closest(pa, pb, q0, q1) else {
                continue;
            };
            if !(unit(s1) && unit(t1)) {
                continue;
            }
            let n1 = if n1.dot(n0) < 0.0 { -n1 } else { n1 };
            let d = side * ((pa + (pb - pa) * s1) - (q0 + (q1 - q0) * t1)).dot(n1);
            let th = self.thickness[ia].max(self.thickness[ib]);
            if d >= th || (d < 0.0 && !within) {
                continue;
            }
            let bary = [1.0 - s1, s1];
            let sum = wa * bary[0] * bary[0] + wb * bary[1] * bary[1];
            if !above(sum, 0.0) {
                continue;
            }
            let dir = n1 * side;
            let depth = th - d;
            self.x[ia] += dir * (wa * bary[0] * depth / sum);
            self.x[ib] += dir * (wb * bary[1] * depth / sum);
            let surface = Self::feature_motion(world, body, q0 + (q1 - q0) * t1, h);
            self.friction_at(&[ia, ib], &bary, dir, depth, surface);
        }
    }

    fn collide_bodies(&mut self, world: &World, h: f32) {
        for k in 0..self.body_cand.len() {
            let (i, b) = self.body_cand[k];
            let i = i as usize;
            let Some(c) = world.collider(b) else { continue };
            let th = self.thickness[i];
            let p = self.x[i];
            let (n, depth) = match c.shape {
                Shape::Sphere { radius } => {
                    let d = p - c.center;
                    let l = d.length();
                    if l >= radius + th {
                        continue;
                    }
                    let n = if above(l, 0.0) {
                        d * (1.0 / l)
                    } else {
                        Vec3::new(0.0, 0.0, 1.0)
                    };
                    (n, radius + th - l)
                }
                Shape::Hull(hull) => {
                    let local = c.rotation.unrotate(p - c.center);
                    let mut best = f32::NEG_INFINITY;
                    let mut bn = Vec3::new(0.0, 0.0, 1.0);
                    for (f, n) in hull.normals.iter().enumerate() {
                        let s = n.dot(local) - hull.offsets[f];
                        if s > best {
                            best = s;
                            bn = *n;
                        }
                    }
                    if best >= th {
                        continue;
                    }
                    (c.rotation.rotate(bn), th - best)
                }
            };
            let r = p - c.center;
            let surface = (c.velocity + c.spin.cross(r)) * h;
            self.contact(i, n, depth, surface, self.friction[i]);
        }
    }

    fn collide_self(&mut self) {
        for k in 0..self.pairs.len() {
            let (i, j, d) = self.pairs[k];
            let (i, j) = (i as usize, j as usize);
            let (wi, wj) = (self.w[i], self.w[j]);
            if wi + wj == 0.0 {
                continue;
            }
            let dx = self.x[i] - self.x[j];
            let l = dx.length();
            if l >= d || !above(l, 0.0) {
                continue;
            }
            let corr = dx * ((d - l) / (l * (wi + wj)));
            self.x[i] += corr * wi;
            self.x[j] -= corr * wj;
        }
    }
}

/// The integrated mean curvature of a sheet per unit area, 1/mm: `Σ |θₑ| |e| / (2 Σ A)` over the
/// edges between two triangles (`θₑ` the dihedral angle there). The measure of how much a cloth is
/// wrinkled, for the tests and the contact sheet.
pub fn mean_curvature(positions: &[Vec3], tris: &[[u32; 3]]) -> f32 {
    let mut edges: Vec<(u32, u32, usize, u32)> = Vec::new();
    let mut area = 0.0f32;
    for (k, t) in tris.iter().enumerate() {
        let [a, b, c] = t.map(|i| positions[i as usize]);
        area += 0.5 * (b - a).cross(c - a).length();
        for s in 0..3 {
            let (p, q, o) = (t[s], t[(s + 1) % 3], t[(s + 2) % 3]);
            edges.push((p.min(q), p.max(q), k, o));
        }
    }
    edges.sort_unstable();
    let mut sum = 0.0f32;
    let mut i = 0;
    while i < edges.len() {
        let mut j = i + 1;
        while j < edges.len() && edges[j].0 == edges[i].0 && edges[j].1 == edges[i].1 {
            j += 1;
        }
        if j - i == 2 {
            let (a, b) = (edges[i].0, edges[i].1);
            let t1 = tris[edges[i].2];
            let forward = (0..3).any(|s| t1[s] == a && t1[(s + 1) % 3] == b);
            let (x0, x1) = if forward { (a, b) } else { (b, a) };
            let p = |v: u32| positions[v as usize];
            let (theta, _) = dihedral(p(x0), p(x1), p(edges[i].3), p(edges[i + 1].3));
            sum += theta.abs() * (p(a) - p(b)).length();
        }
        i = j;
    }
    if above(area, 0.0) {
        sum / (2.0 * area)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fd(f: &dyn Fn([Vec3; 4]) -> f32, x: [Vec3; 4], i: usize) -> Vec3 {
        let h = 1.0e-3f32;
        let mut out = [0.0f32; 3];
        for (c, o) in out.iter_mut().enumerate() {
            let mut a = x;
            let mut b = x;
            let mut d = Vec3::ZERO;
            match c {
                0 => d.x = h,
                1 => d.y = h,
                _ => d.z = h,
            }
            a[i] += d;
            b[i] -= d;
            *o = (f(a) - f(b)) / (2.0 * h);
        }
        Vec3::new(out[0], out[1], out[2])
    }

    #[test]
    fn the_dihedral_gradients_are_the_finite_differences() {
        let cases = [
            [
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.3, 1.0, 0.2),
                Vec3::new(0.6, -1.0, 0.4),
            ],
            [
                Vec3::new(0.1, 0.2, 0.0),
                Vec3::new(1.2, -0.1, 0.3),
                Vec3::new(0.4, 0.9, -0.5),
                Vec3::new(0.9, -0.8, -0.6),
            ],
            // Flat.
            [
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.5, 1.0, 0.0),
                Vec3::new(0.5, -1.0, 0.0),
            ],
        ];
        let f = |x: [Vec3; 4]| dihedral(x[0], x[1], x[2], x[3]).0;
        for x in cases {
            let (_, g) = dihedral(x[0], x[1], x[2], x[3]);
            let mut sum = Vec3::ZERO;
            for (i, gi) in g.iter().enumerate() {
                let want = fd(&f, x, i);
                assert!(
                    (*gi - want).length() < 2.0e-2 * want.length().max(1.0),
                    "vertex {i}: {gi:?} against {want:?}"
                );
                sum += *gi;
            }
            assert!(sum.length() < 1.0e-4, "the gradients add to {sum:?}");
        }
        // Flat is zero; folding the wing up is negative.
        let flat = cases[2];
        assert_eq!(f(flat), 0.0);
        let mut up = flat;
        up[2].z = 0.1;
        assert!(f(up) < 0.0);
    }

    /// A sheet of `n × n` squares of `side` mm (split along alternating diagonals), of `params`.
    fn sheet(n: u32, side: f32, params: ClothParams) -> Cloth {
        let mut positions = Vec::new();
        for j in 0..=n {
            for i in 0..=n {
                positions.push(Vec3::new(i as f32 * side, j as f32 * side, 0.0));
            }
        }
        let at = |i: u32, j: u32| j * (n + 1) + i;
        let mut indices = Vec::new();
        for j in 0..n {
            for i in 0..n {
                let (a, b, c, d) = (at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
                if (i + j) % 2 == 0 {
                    indices.extend_from_slice(&[a, b, c, a, c, d]);
                } else {
                    indices.extend_from_slice(&[a, b, d, b, c, d]);
                }
            }
        }
        let count = positions.len();
        Cloth::new(&ClothSpec {
            pieces: vec![ClothPiece {
                positions,
                indices,
                pinned: vec![false; count],
                params,
            }],
            ..ClothSpec::default()
        })
    }

    #[test]
    fn the_bending_stores_the_calibrated_share_of_the_continuum_on_a_cylinder() {
        // Bent along its warp (about Y) and along its weft (about X) into a cylinder of radius R,
        // the alternating-diagonal sheet stores `BEND_CALIBRATION × ½ B κ²` over the area its
        // hinges span: every hinge across the bend turns by `κ a`, those along it not at all.
        let (n, side, r) = (40u32, 2.0f32, 300.0f32);
        let params = ClothParams {
            bend: 1.0e-5,
            ..ClothParams::default()
        };
        let c = sheet(n, side, params);
        let flat: Vec<Vec3> = (0..c.particle_count()).map(|i| c.particle(i)).collect();
        assert_eq!(c.bending_energy(&flat), 0.0);
        let b = params.bend * NM_TO_KG_MM2;
        let spanned = (n - 1) as f32 * side * n as f32 * side;
        let continuum = 0.5 * b / (r * r) * spanned;
        let bent = |along_x: bool| -> Vec<Vec3> {
            flat.iter()
                .map(|p| {
                    let s = if along_x { p.x } else { p.y };
                    let (sn, cs) = fmath::sin_cos(s / r);
                    let (u, z) = (r * sn, r * (1.0 - cs));
                    if along_x {
                        Vec3::new(u, p.y, z)
                    } else {
                        Vec3::new(p.x, u, z)
                    }
                })
                .collect()
        };
        for along_x in [true, false] {
            let ratio = c.bending_energy(&bent(along_x)) / continuum;
            assert!(
                (ratio / BEND_CALIBRATION - 1.0).abs() < 0.01,
                "bent along {}: {ratio} of the continuum",
                if along_x { "the warp" } else { "the weft" }
            );
        }
    }

    #[test]
    fn the_membrane_stores_its_stiffness_along_the_warp_the_weft_and_in_shear() {
        let params = ClothParams {
            stretch: 4000.0,
            shear: 60.0,
            ..ClothParams::default()
        };
        let (n, side) = (8u32, 5.0f32);
        let c = sheet(n, side, params);
        let flat: Vec<Vec3> = (0..c.particle_count()).map(|i| c.particle(i)).collect();
        assert!(c.membrane_energy(&flat) < 1.0e-6);
        let area = (n as f32 * side).powi(2);
        let moved = |f: &dyn Fn(Vec3) -> Vec3| flat.iter().map(|p| f(*p)).collect::<Vec<_>>();
        let (eps, gamma) = (0.01f32, 0.02f32);
        // N/m is kg/s²: ½ k ε² A in kg·mm²/s².
        let warp = c.membrane_energy(&moved(&|p| Vec3::new(p.x * (1.0 + eps), p.y, 0.0)));
        let weft = c.membrane_energy(&moved(&|p| Vec3::new(p.x, p.y * (1.0 + eps), 0.0)));
        let shear = c.membrane_energy(&moved(&|p| Vec3::new(p.x + gamma * p.y, p.y, 0.0)));
        let want = |k: f32, s: f32| 0.5 * k * s * s * area;
        for (name, got, w) in [
            ("warp", warp, want(params.stretch, eps)),
            ("weft", weft, want(params.stretch, eps)),
            ("shear", shear, want(params.shear, gamma)),
        ] {
            assert!((got / w - 1.0).abs() < 0.02, "{name}: {got} against {w}");
        }
        // The threads scissor far more easily than they stretch.
        assert!(shear < 0.1 * warp);
    }

    #[test]
    fn the_warp_runs_along_x_and_falls_back_to_y_on_a_face_square_to_it() {
        let z = Vec3::new(0.0, 0.0, 1.0);
        let (u, v) = grain(z, WARP);
        assert!((u - Vec3::new(1.0, 0.0, 0.0)).length() < 1.0e-6);
        assert!((v - Vec3::new(0.0, 1.0, 0.0)).length() < 1.0e-6);
        // A face looking along X takes Y.
        let (u, _) = grain(Vec3::new(1.0, 0.0, 0.0), WARP);
        assert!((u - Vec3::new(0.0, 1.0, 0.0)).length() < 1.0e-6);
        // A tilted one keeps X projected while it can.
        let n = Vec3::new(0.5, 0.0, 0.866_025_4);
        let (u, v) = grain(n, WARP);
        assert!(u.dot(n).abs() < 1.0e-6 && v.dot(n).abs() < 1.0e-6 && u.x > 0.8);
        // Another warp.
        let (u, _) = grain(z, Vec3::new(1.0, 1.0, 0.0));
        assert!((u.x - u.y).abs() < 1.0e-6 && u.x > 0.7);
    }

    #[test]
    fn a_version_1_spec_reads_with_the_shear_of_an_isotropic_sheet() {
        let spec = ClothSpec {
            pieces: vec![ClothPiece {
                positions: vec![
                    Vec3::ZERO,
                    Vec3::new(1.0, 0.0, 0.0),
                    Vec3::new(0.0, 1.0, 0.0),
                ],
                indices: vec![0, 1, 2],
                pinned: vec![false; 3],
                params: ClothParams {
                    shear: ClothParams::default().stretch * V1_SHEAR_SHARE,
                    ..ClothParams::default()
                },
            }],
            ..ClothSpec::default()
        };
        let v2 = spec.to_bytes();
        // Version 1: the same without the shear (after the stretch) and the warp (before the flags).
        let mut v1 = v2.clone();
        v1[4..8].copy_from_slice(&1u32.to_le_bytes());
        let params_at = 4 + 4 + 4 + 8 + 3 * 12 + 3 * 4 + 4;
        let flags_at = params_at + 12 * 4;
        let mut cut = v1[..params_at + 8].to_vec();
        cut.extend_from_slice(&v1[params_at + 12..flags_at - 12]);
        cut.extend_from_slice(&v1[flags_at..]);
        assert_eq!(ClothSpec::parse(&cut).unwrap(), spec);
        let mut v3 = v2.clone();
        v3[4..8].copy_from_slice(&3u32.to_le_bytes());
        assert!(ClothSpec::parse(&v3).is_err());
    }

    #[test]
    fn a_spec_survives_its_own_format() {
        let spec = ClothSpec {
            pieces: vec![ClothPiece {
                positions: (0..33).map(|i| Vec3::new(i as f32, 0.5, -1.0)).collect(),
                indices: vec![0, 1, 2, 2, 1, 3],
                pinned: (0..33).map(|i| i % 7 == 0).collect(),
                params: ClothParams::default(),
            }],
            statics: vec![ClothStatic {
                positions: vec![
                    Vec3::ZERO,
                    Vec3::new(1.0, 0.0, 0.0),
                    Vec3::new(0.0, 1.0, 0.0),
                ],
                indices: vec![0, 1, 2],
            }],
            floor: Some((0.0, 0.6)),
            wind: ClothWind {
                velocity: Vec3::new(1000.0, 0.0, 0.0),
                gust: 0.3,
                scale: 200.0,
                speed: 500.0,
                seed: 7,
            },
        };
        let bytes = spec.to_bytes();
        assert_eq!(ClothSpec::parse(&bytes).unwrap(), spec);
        assert!(ClothSpec::parse(&bytes[..bytes.len() - 4]).is_err());
        assert!(ClothSpec::parse(b"PHY1").is_err());
        let mut more = bytes.clone();
        more.extend_from_slice(&[0; 4]);
        assert!(ClothSpec::parse(&more).is_err());
    }

    #[test]
    fn seams_are_welded_and_anchors_hold() {
        // Two triangles that do not share indices but share positions.
        let positions = vec![
            Vec3::new(0.0, 0.0, 100.0),
            Vec3::new(10.0, 0.0, 100.0),
            Vec3::new(0.0, 10.0, 100.0),
            Vec3::new(10.0, 0.0, 100.0),
            Vec3::new(10.0, 10.0, 100.0),
            Vec3::new(0.0, 10.0, 100.0),
        ];
        let spec = ClothSpec {
            pieces: vec![ClothPiece {
                positions,
                indices: vec![0, 1, 2, 3, 4, 5],
                pinned: vec![true, false, false, false, false, false],
                params: ClothParams::default(),
            }],
            ..ClothSpec::default()
        };
        let mut c = Cloth::new(&spec);
        assert_eq!(c.particle_count(), 4);
        assert_eq!(c.vertex_count(), 6);
        assert_eq!(c.particle_of_vertex(1), c.particle_of_vertex(3));
        c.step(60, None);
        assert_eq!(c.particle(0), Vec3::new(0.0, 0.0, 100.0));
        let p = c.positions();
        // The welded copies move together, and the free corner fell.
        assert_eq!(&p[3..6], &p[9..12]);
        assert!(p[3 * 4 + 2] < 100.0);
    }
}

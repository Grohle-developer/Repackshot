//! Liquids (phase S7): position based fluids (Macklin and Müller, "Position Based Fluids", ACM
//! TOG 32(4), SIGGRAPH 2013) with XSPH viscosity (Schechter and Bridson, "Ghost SPH for Animating
//! Water", SIGGRAPH 2012, after Monaghan's XSPH), cohesion and surface tension (Akinci, Akinci and
//! Teschner, "Versatile Surface Tension and Adhesion for SPH Fluids", SIGGRAPH Asia 2013), and the
//! walls as a density of their own (the wall weight of Harada, Koshizuka and Kawaguchi,
//! "Smoothed Particle Hydrodynamics on GPUs", 2007). Written from the papers; no code from any
//! fluid library.
//!
//! **Units and step.** Millimetres, seconds, gravity 9810 mm/s² along −Z, the simulator's fixed
//! step of 1/240 s ([`crate::world::STEP`]) in [`SUBSTEPS`] substeps of [`ITERATIONS`] density
//! iterations each. A liquid is particles on a lattice of its *spacing* (each stands for a cube of
//! that side: [`fill`] makes them by ray parity from the part's mesh); the kernel reaches
//! [`SMOOTHING`] spacings.
//!
//! **Density.** The constraint of particle `i` is `C_i = n_i / n₀ − 1`, kept only where it is
//! positive (a particle is pushed apart, never pulled together: cohesion does that), with `n_i`
//! the sum of `w(r) = (1 − r²/h²)³` over its neighbours and itself, plus the wall's share when it
//! is within `h` of one (the integral of the kernel over the half space beyond the nearest wall,
//! in closed form), and `n₀` the same sum over a lattice. A Newton step of the constraints along
//! their exact gradients (Jacobi, as the paper), relaxed by [`RELAXATION`].
//!
//! **Walls.** The containers are the static parts of the scene (their triangles, two-sided), the
//! floor and a box around the liquid ([`LiquidWorld::domain`]), so a splash that leaves every
//! part still stops somewhere. A particle that would cross a triangle in a substep stops on its
//! side of it (swept), and none comes closer than [`MIN_GAP`] spacings to a wall. The wall's share
//! of the density is taken as if the wall were [`WALL_OVERLAP`] spacings further away, so the
//! liquid's surface reaches that far into its container's wall: liquid and glass overlap a little
//! instead of leaving a film of air, and the nested dielectrics of the renderer resolve the
//! overlap by priority (◆ for the verdict).
//!
//! **Viscosity, cohesion, adhesion.** After the positions, XSPH blends each particle's velocity
//! towards its neighbours' by the liquid's `viscosity` (a fraction per substep) and slows the
//! motion along a wall by the same fraction, weighted by the wall's share (the liquid does not
//! slip along its container; honey creeps). Before the step, Akinci's cohesion (its spline) and
//! curvature terms pull the surface together, and adhesion draws the liquid towards the walls
//! within reach, each scaled by the liquid's coefficient times gravity.
//!
//! **Determinism.** Every particle's update reads the state before the pass and writes only its
//! own values (Jacobi), its neighbours come in a fixed order (by cell, then by index), and the
//! passes are split into [`LiquidWorld::set_workers`] chunks that a [`Runner`] may run on threads:
//! the same scene gives the same particles, bit for bit, natively and in WebAssembly, whatever
//! the number of chunks or threads ([`LiquidWorld::hash`] is the check).
//!
//! **What the page gets.** Each frame, per liquid, the particles quantised to 16 bits in the
//! world box ([`LiquidWorld::frame`], the `LQF1` record) and the surface rebuilt from that record
//! by marching cubes ([`surface`], [`mesh_from_frame`]): the page records the first and renders
//! the second, so a frame shows the same mesh live and when it is played back.

pub mod example;
pub mod fill;
pub mod surface;

use crate::scene::SceneMesh;
use crate::world::Transform;
use rt_core::math::Vec3;

/// The magic number of a liquid scene.
pub const MAGIC: &[u8; 4] = b"LIQ1";
/// The version this reader understands.
pub const VERSION: u32 = 1;
/// The magic number of a frame record.
pub const FRAME_MAGIC: &[u8; 4] = b"LQF1";
/// Bytes of a frame record before its particles.
pub const FRAME_HEADER: usize = 36;
/// Substeps per step of 1/240 s.
pub const SUBSTEPS: u32 = 2;
/// Density iterations per substep.
pub const ITERATIONS: u32 = 3;
/// The settled liquid's kernel sum over the close packing's (the solver's particles settle
/// into an arrangement that reaches the packing's sum at a higher number density: this keeps
/// each particle at its share of the volume).
pub const REST_PACKING: f32 = 0.90;
/// The kernel's radius, in particle spacings.
pub const SMOOTHING: f32 = 2.0;
/// The closest a particle comes to a wall, in spacings.
pub const MIN_GAP: f32 = 0.25;
/// How far beyond its container's walls the liquid's surface reaches, in spacings (◆).
pub const WALL_OVERLAP: f32 = 0.1;
/// The relaxation of the density step, a fraction of a lattice particle's denominator.
pub const RELAXATION: f32 = 0.05;
/// The fastest a particle moves, in kernel radii per substep.
pub const MAX_SPEED: f32 = 0.4;
/// XSPH's smoothing of the velocities, every liquid (a share per substep).
pub const XSPH: f32 = 0.01;
/// Most Jacobi iterations of the implicit viscosity per substep (a liquid takes about its `α`).
pub const MAX_VISCOUS_ITERATIONS: u32 = 16;
/// Most walls a particle feels at once (one per wall, two or three in a corner).
pub const CONTACTS: usize = 3;
/// Floats per particle of its walls: the count, then a point and a direction per wall.
const CONTACT_FLOATS: usize = 1 + 6 * CONTACTS;
/// Gravity, mm/s², along −Z.
pub const GRAVITY: f32 = 9810.0;
/// Most particles in a scene (every liquid together).
pub const MAX_PARTICLES: usize = 400_000;
/// The box around the liquid reaches this many times its size beyond it (and at least
/// [`DOMAIN_MIN_SPACINGS`] spacings).
pub const DOMAIN_MARGIN: f32 = 1.0;
/// How far the box around the liquid may grow to hold the containers it touches, in margins.
pub const DOMAIN_REACH: f32 = 4.0;
/// The least margin of the box around the liquid, in spacings.
pub const DOMAIN_MIN_SPACINGS: f32 = 20.0;

/// What a liquid is like. The density is the liquid's mass per volume (kg/m³): it does not
/// change how a liquid alone moves (an incompressible liquid falls and flows the same whatever it
/// weighs) and is kept for the page; the others shape the motion.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LiquidParams {
    /// kg/m³.
    pub density: f32,
    /// Kinematic viscosity, mm²/s (centistokes): water 1, honey thousands.
    pub viscosity: f32,
    /// Cohesion (Akinci's spline), times gravity.
    pub cohesion: f32,
    /// Surface tension (Akinci's curvature term), times gravity.
    pub surface_tension: f32,
    /// Adhesion to the walls, times gravity.
    pub adhesion: f32,
}

impl LiquidParams {
    /// Water.
    pub const WATER: LiquidParams = LiquidParams {
        density: 1000.0,
        viscosity: 1.0,
        cohesion: 0.1,
        surface_tension: 0.02,
        adhesion: 0.05,
    };
    /// Honey.
    pub const HONEY: LiquidParams = LiquidParams {
        density: 1420.0,
        viscosity: 10000.0,
        cohesion: 0.3,
        surface_tension: 0.05,
        adhesion: 0.5,
    };
}

/// A liquid of the scene: the part it fills and how.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LiquidSource {
    /// The mesh it fills (index into the scene's meshes).
    pub mesh: u32,
    /// The mesh's object-to-world transform.
    pub transform: Transform,
    /// The particle spacing, mm.
    pub spacing: f32,
    /// What it is like.
    pub params: LiquidParams,
}

/// A static part of the scene (a container).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StaticPiece {
    /// Index into the meshes.
    pub mesh: u32,
    /// Object to world.
    pub transform: Transform,
}

/// `LIQ1`, the scene the page hands the liquid simulator. Little-endian, 4-byte words:
///
/// ```text
/// "LIQ1"  u32 version (1)
/// u32 meshes; per mesh: u32 vertices, u32 indices, f32 positions[3 × vertices], u32 indices[]
/// u32 statics; per static: u32 mesh, f32 rows[12] (3 × 4, object to world)
/// u32 floor (0 none, 1 yes), f32 z
/// u32 liquids; per liquid: u32 mesh, f32 rows[12], f32 spacing (mm), f32 density (kg/m³),
///             f32 viscosity, f32 cohesion, f32 surface_tension, f32 adhesion
/// ```
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LiquidSpec {
    /// The meshes.
    pub meshes: Vec<SceneMesh>,
    /// The containers.
    pub statics: Vec<StaticPiece>,
    /// The floor's height, if there is a floor.
    pub floor: Option<f32>,
    /// The liquids.
    pub liquids: Vec<LiquidSource>,
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
            .ok_or_else(|| format!("LIQ1: cut short at byte {}", self.at))?;
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
                "LIQ1: a value that is not finite at byte {}",
                self.at - 4
            ))
        }
    }
    fn count(&mut self, bytes: usize) -> Result<usize, String> {
        let n = self.u32()? as usize;
        if n.saturating_mul(bytes) > self.bytes.len() - self.at {
            return Err(format!("LIQ1: a count of {n} does not fit in the file"));
        }
        Ok(n)
    }
    fn transform(&mut self) -> Result<Transform, String> {
        let mut rows = [[0.0f32; 4]; 3];
        for row in rows.iter_mut() {
            for v in row.iter_mut() {
                *v = self.f32()?;
            }
        }
        Ok(Transform { rows })
    }
    fn mesh_index(&mut self, meshes: usize) -> Result<u32, String> {
        let m = self.u32()?;
        if m as usize >= meshes {
            return Err(format!("LIQ1: mesh {m} of {meshes}"));
        }
        Ok(m)
    }
}

impl LiquidSpec {
    /// Reads a `LIQ1` file.
    pub fn parse(bytes: &[u8]) -> Result<LiquidSpec, String> {
        let mut r = Reader { bytes, at: 0 };
        if r.word()? != *MAGIC {
            return Err("LIQ1: not a liquid scene".into());
        }
        let version = r.u32()?;
        if version != VERSION {
            return Err(format!(
                "LIQ1: version {version}, this simulator reads {VERSION}"
            ));
        }
        let mut spec = LiquidSpec::default();
        let meshes = r.count(8)?;
        for _ in 0..meshes {
            let nv = r.count(12)?;
            let ni = r.u32()? as usize;
            let mut positions = Vec::with_capacity(nv);
            for _ in 0..nv {
                positions.push(Vec3::new(r.f32()?, r.f32()?, r.f32()?));
            }
            if ni.saturating_mul(4) > bytes.len() - r.at || !ni.is_multiple_of(3) {
                return Err("LIQ1: an index count that does not fit".into());
            }
            let mut indices = Vec::with_capacity(ni);
            for _ in 0..ni {
                let i = r.u32()?;
                if i as usize >= nv {
                    return Err(format!("LIQ1: index {i} of a mesh of {nv} vertices"));
                }
                indices.push(i);
            }
            spec.meshes.push(SceneMesh { positions, indices });
        }
        let statics = r.count(52)?;
        for _ in 0..statics {
            let mesh = r.mesh_index(spec.meshes.len())?;
            let transform = r.transform()?;
            spec.statics.push(StaticPiece { mesh, transform });
        }
        let floor = r.u32()?;
        let z = r.f32()?;
        if floor > 1 {
            return Err(format!("LIQ1: floor flag {floor}"));
        }
        spec.floor = (floor == 1).then_some(z);
        let liquids = r.count(76)?;
        for _ in 0..liquids {
            let mesh = r.mesh_index(spec.meshes.len())?;
            let transform = r.transform()?;
            let spacing = r.f32()?;
            if !crate::math::above(spacing, 0.0) {
                return Err(format!("LIQ1: a spacing of {spacing} mm"));
            }
            let params = LiquidParams {
                density: r.f32()?,
                viscosity: r.f32()?,
                cohesion: r.f32()?,
                surface_tension: r.f32()?,
                adhesion: r.f32()?,
            };
            spec.liquids.push(LiquidSource {
                mesh,
                transform,
                spacing,
                params,
            });
        }
        if r.at != bytes.len() {
            return Err(format!("LIQ1: {} bytes after the end", bytes.len() - r.at));
        }
        Ok(spec)
    }

    /// Writes the scene as `LIQ1`.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let u = |out: &mut Vec<u8>, v: u32| out.extend_from_slice(&v.to_le_bytes());
        let f = |out: &mut Vec<u8>, v: f32| out.extend_from_slice(&v.to_le_bytes());
        let t = |out: &mut Vec<u8>, t: &Transform| {
            for row in &t.rows {
                for &v in row {
                    out.extend_from_slice(&v.to_le_bytes());
                }
            }
        };
        out.extend_from_slice(MAGIC);
        u(&mut out, VERSION);
        u(&mut out, self.meshes.len() as u32);
        for m in &self.meshes {
            u(&mut out, m.positions.len() as u32);
            u(&mut out, m.indices.len() as u32);
            for p in &m.positions {
                f(&mut out, p.x);
                f(&mut out, p.y);
                f(&mut out, p.z);
            }
            for &i in &m.indices {
                u(&mut out, i);
            }
        }
        u(&mut out, self.statics.len() as u32);
        for s in &self.statics {
            u(&mut out, s.mesh);
            t(&mut out, &s.transform);
        }
        u(&mut out, self.floor.is_some() as u32);
        f(&mut out, self.floor.unwrap_or(0.0));
        u(&mut out, self.liquids.len() as u32);
        for l in &self.liquids {
            u(&mut out, l.mesh);
            t(&mut out, &l.transform);
            f(&mut out, l.spacing);
            let p = &l.params;
            for v in [
                p.density,
                p.viscosity,
                p.cohesion,
                p.surface_tension,
                p.adhesion,
            ] {
                f(&mut out, v);
            }
        }
        out
    }
}

// ------------------------------------------------------------------ chunks and threads

/// Runs the chunks of a pass. Each job returns its chunk's values; the results come back in
/// chunk order whatever order the jobs ran in.
pub trait Runner: Sync {
    /// Runs `jobs` jobs and returns their results in job order.
    fn run(&self, jobs: usize, job: &(dyn Fn(usize) -> Vec<f32> + Sync)) -> Vec<Vec<f32>>;
}

/// One job after another, the last first (as threads that finish out of order would).
pub struct Serial;

impl Runner for Serial {
    fn run(&self, jobs: usize, job: &(dyn Fn(usize) -> Vec<f32> + Sync)) -> Vec<Vec<f32>> {
        let mut out: Vec<Vec<f32>> = (0..jobs).rev().map(job).collect();
        out.reverse();
        out
    }
}

/// Runs `f(i, out)` for every `i` in `0..n`, split into `chunks` ranges, and joins what they
/// push in order.
fn pass<F>(runner: &dyn Runner, chunks: usize, n: usize, stride: usize, f: F) -> Vec<f32>
where
    F: Fn(usize, &mut Vec<f32>) + Sync,
{
    let chunks = chunks.clamp(1, n.max(1));
    let parts = runner.run(chunks, &|c| {
        let (lo, hi) = (n * c / chunks, n * (c + 1) / chunks);
        let mut out = Vec::with_capacity((hi - lo) * stride);
        for i in lo..hi {
            f(i, &mut out);
        }
        out
    });
    let mut all = Vec::with_capacity(n * stride);
    for p in parts {
        all.extend_from_slice(&p);
    }
    all
}

#[inline]
fn v3(s: &[f32], i: usize) -> Vec3 {
    Vec3::new(s[3 * i], s[3 * i + 1], s[3 * i + 2])
}

#[inline]
fn push3(out: &mut Vec<f32>, v: Vec3) {
    out.extend_from_slice(&[v.x, v.y, v.z]);
}

// ------------------------------------------------------------------ the walls

/// A static triangle and its unit normal.
#[derive(Clone, Copy, Debug)]
struct Tri {
    v: [Vec3; 3],
    n: Vec3,
    lo: Vec3,
    hi: Vec3,
}

/// The closest point of a triangle to `p` (by the Voronoi regions of its corners, edges and
/// face).
fn closest_on_triangle(p: Vec3, t: &[Vec3; 3]) -> Vec3 {
    let (a, b, c) = (t[0], t[1], t[2]);
    let (ab, ac, ap) = (b - a, c - a, p - a);
    let (d1, d2) = (ab.dot(ap), ac.dot(ap));
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = p - b;
    let (d3, d4) = (ab.dot(bp), ac.dot(bp));
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let v = d1 / (d1 - d3);
        return a + ab * v;
    }
    let cp = p - c;
    let (d5, d6) = (ab.dot(cp), ac.dot(cp));
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let w = d2 / (d2 - d6);
        return a + ac * w;
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return b + (c - b) * w;
    }
    let denom = 1.0 / (va + vb + vc);
    let (v, w) = (vb * denom, vc * denom);
    a + ab * v + ac * w
}

/// Where the segment `a + t (b − a)`, `t` in `[0, 1]`, crosses the triangle (Möller and Trumbore,
/// "Fast, Minimum Storage Ray/Triangle Intersection", 1997).
fn segment_hits(a: Vec3, b: Vec3, t: &[Vec3; 3]) -> Option<f32> {
    let d = b - a;
    let (e1, e2) = (t[1] - t[0], t[2] - t[0]);
    let p = d.cross(e2);
    let det = e1.dot(p);
    if det.abs() < 1.0e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let s = a - t[0];
    let u = s.dot(p) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = s.cross(e1);
    let v = d.dot(q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let k = e2.dot(q) * inv;
    (0.0..=1.0).contains(&k).then_some(k)
}

/// The walls: the static triangles in a grid of cells, the floor and the box.
#[derive(Clone, Debug)]
struct Walls {
    tris: Vec<Tri>,
    /// (cell, triangle), sorted: every triangle in every cell within `cell` of it.
    cells: Vec<(u32, u32)>,
    lo: Vec3,
    hi: Vec3,
    cell: f32,
    dims: [u32; 3],
    floor: Option<f32>,
}

impl Walls {
    fn cell_of(&self, p: Vec3) -> Option<u32> {
        let g = (p - self.lo) * (1.0 / self.cell);
        if !(g.x >= 0.0 && g.y >= 0.0 && g.z >= 0.0) {
            return None;
        }
        let (x, y, z) = (g.x as u32, g.y as u32, g.z as u32);
        if x >= self.dims[0] || y >= self.dims[1] || z >= self.dims[2] {
            return None;
        }
        Some(x + self.dims[0] * (y + self.dims[1] * z))
    }

    fn near(&self, p: Vec3) -> &[(u32, u32)] {
        let Some(c) = self.cell_of(p) else {
            return &[];
        };
        let start = self.cells.partition_point(|&(k, _)| k < c);
        let end = self.cells.partition_point(|&(k, _)| k <= c);
        &self.cells[start..end]
    }

    /// The walls within reach of `p` as planes: up to [`CONTACTS`] of them, the nearest first,
    /// each farther one facing at least 25° away from those before it (one per wall, two in a
    /// corner), as the closest point and the unit direction from it to `p`. Pushes the count and
    /// six floats per plane, [`CONTACT_FLOATS`] in all.
    fn contacts(&self, p: Vec3, out: &mut Vec<f32>) {
        // The nearest candidates so far, sorted by distance (equal ones in the order found).
        const KEEP: usize = 16;
        let mut found = [(0.0f32, Vec3::ZERO, Vec3::ZERO); KEEP];
        let mut len = 0usize;
        let mut add = |d: f32, c: Vec3, n: Vec3| {
            if d >= self.cell || (len == KEEP && d >= found[KEEP - 1].0) {
                return;
            }
            let mut k = len.min(KEEP - 1);
            while k > 0 && found[k - 1].0 > d {
                found[k] = found[k - 1];
                k -= 1;
            }
            found[k] = (d, c, n);
            len = (len + 1).min(KEEP);
        };
        let limit2 = self.cell * self.cell;
        for &(_, t) in self.near(p) {
            let tri = &self.tris[t as usize];
            let gap = (tri.lo - p).max(p - tri.hi).max(Vec3::ZERO);
            if gap.length_squared() >= limit2 {
                continue;
            }
            let q = closest_on_triangle(p, &tri.v);
            let d = (p - q).length();
            let side = if (p - q).dot(tri.n) >= 0.0 {
                tri.n
            } else {
                -tri.n
            };
            let n = if d > 1.0e-6 {
                (p - q) * (1.0 / d)
            } else {
                side
            };
            add(d, q, n);
        }
        let mut plane = |d: f32, n: Vec3| add(d, p - n * d, n);
        if let Some(z) = self.floor {
            plane((p.z - z).max(0.0), Vec3::new(0.0, 0.0, 1.0));
        }
        plane((p.x - self.lo.x).max(0.0), Vec3::new(1.0, 0.0, 0.0));
        plane((self.hi.x - p.x).max(0.0), Vec3::new(-1.0, 0.0, 0.0));
        plane((p.y - self.lo.y).max(0.0), Vec3::new(0.0, 1.0, 0.0));
        plane((self.hi.y - p.y).max(0.0), Vec3::new(0.0, -1.0, 0.0));
        plane((p.z - self.lo.z).max(0.0), Vec3::new(0.0, 0.0, 1.0));
        plane((self.hi.z - p.z).max(0.0), Vec3::new(0.0, 0.0, -1.0));
        let at = out.len();
        out.push(0.0);
        let mut chosen: [Vec3; CONTACTS] = [Vec3::ZERO; CONTACTS];
        let mut k = 0;
        for &(_, c, n) in &found[..len] {
            if k == CONTACTS {
                break;
            }
            if chosen[..k].iter().any(|m| m.dot(n) > 0.906) {
                continue;
            }
            chosen[k] = n;
            k += 1;
            push3(out, c);
            push3(out, n);
        }
        out.resize(at + CONTACT_FLOATS, 0.0);
        out[at] = k as f32;
    }

    /// The segment `a → b` stopped `gap` before the first triangle it crosses, and kept `gap`
    /// inside the floor and the box.
    fn sweep(&self, a: Vec3, b: Vec3, gap: f32) -> Vec3 {
        let mut first: Option<(f32, Vec3)> = None;
        for &(_, t) in self.near(a) {
            let tri = &self.tris[t as usize];
            if let Some(k) = segment_hits(a, b, &tri.v) {
                if first.is_none_or(|(fk, _)| k < fk) {
                    first = Some((k, tri.n));
                }
            }
        }
        let mut p = match first {
            Some((k, n)) => {
                // Back to the side `a` is on.
                let side = if (a - b).dot(n) >= 0.0 { n } else { -n };
                a + (b - a) * k + side * gap
            }
            None => b,
        };
        self.clamp(&mut p, gap);
        p
    }

    fn clamp(&self, p: &mut Vec3, gap: f32) {
        let lo = Vec3::new(
            self.lo.x + gap,
            self.lo.y + gap,
            self.floor.map_or(self.lo.z, |z| z.max(self.lo.z)) + gap,
        );
        let hi = self.hi - Vec3::splat(gap);
        *p = p.max(lo).min(hi);
    }
}

// ------------------------------------------------------------------ kernels

/// `(1 − r²/h²)³` within `h`.
#[inline]
fn w(r2: f32, h2: f32) -> f32 {
    surface::kernel(r2, h2)
}

/// `∇_i w(|x_i − x_j|)` for `d = x_i − x_j`: `−6 (1 − r²/h²)² d / h²`.
#[inline]
fn grad_w(d: Vec3, r2: f32, h2: f32) -> Vec3 {
    if r2 >= h2 {
        return Vec3::ZERO;
    }
    let q = 1.0 - r2 / h2;
    d * (-6.0 * q * q / h2)
}

/// `∫_t^1 (1 − u²)⁴ du`.
fn tail(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    let f = |t: f32| {
        let t2 = t * t;
        t * (1.0 + t2 * (-4.0 / 3.0 + t2 * (6.0 / 5.0 + t2 * (-4.0 / 7.0 + t2 / 9.0))))
    };
    f(1.0) - f(t)
}

/// Akinci's cohesion spline over its peak (at `h/2`): 1 there, 0 at `h`, −1 at 0.
#[inline]
fn cohesion_spline(r: f32, h: f32) -> f32 {
    if r >= h || r <= 0.0 {
        return 0.0;
    }
    let a = (h - r) * r;
    let x = 64.0 * a * a * a / (h * h * h * h * h * h);
    if 2.0 * r > h {
        x
    } else {
        2.0 * x - 1.0
    }
}

// ------------------------------------------------------------------ one liquid

/// One liquid in the world: its particles and what it is like.
#[derive(Clone, Debug)]
struct Fluid {
    params: LiquidParams,
    spacing: f32,
    h: f32,
    /// The lattice's sum of the kernel.
    n0: f32,
    /// The wall's share of the density over its integral (so a lattice against a flat wall has
    /// `n₀`).
    wall_scale: f32,
    /// The relaxation of the density step.
    eps: f32,
    x: Vec<Vec3>,
    v: Vec<Vec3>,
    /// The neighbours of each particle (compressed rows): `list[start[i]..start[i + 1]]`.
    start: Vec<u32>,
    list: Vec<u32>,
    /// The walls near each particle at the end of the last substep (`CONTACT_FLOATS` each).
    contacts: Vec<f32>,
}

impl Fluid {
    fn new(points: Vec<Vec3>, spacing: f32, params: LiquidParams) -> Fluid {
        let h = SMOOTHING * spacing;
        let h2 = h * h;
        let n0 = REST_PACKING * surface::lattice_sum(spacing, h);
        // The half space's share, ∫ over z > 0 of the kernel per particle volume.
        let half =
            std::f32::consts::PI * h * h * h / (4.0 * spacing * spacing * spacing) * tail(0.0);
        let wall_scale = n0 / (2.0 * half);
        // A lattice particle's denominator: Σ_j |∇w|² / n₀² (its own gradient is zero).
        let reach = (h / spacing) as i32 + 1;
        let mut denom = 0.0f32;
        for z in -reach..=reach {
            for y in -reach..=reach {
                for x in -reach..=reach {
                    let d = Vec3::new(x as f32, y as f32, z as f32) * spacing;
                    let g = grad_w(d, d.length_squared(), h2);
                    denom += g.length_squared();
                }
            }
        }
        let eps = RELAXATION * denom / (n0 * n0);
        let n = points.len();
        Fluid {
            params,
            spacing,
            h,
            n0,
            wall_scale,
            eps,
            v: vec![Vec3::ZERO; n],
            x: points,
            start: vec![0; n + 1],
            list: Vec::new(),
            contacts: Vec::new(),
        }
    }

    /// The wall's share of a particle's density at distance `d`, and its derivative.
    fn wall(&self, d: f32) -> (f32, f32) {
        let d = d + WALL_OVERLAP * self.spacing;
        if d >= self.h {
            return (0.0, 0.0);
        }
        let s3 = self.spacing * self.spacing * self.spacing;
        let k = self.wall_scale * std::f32::consts::PI * self.h * self.h * self.h / (4.0 * s3);
        let t = d / self.h;
        let q = 1.0 - t * t;
        (k * tail(t), -k * q * q * q * q / self.h)
    }

    /// The neighbours of every particle at positions `p` (inside the box `lo..hi`), by a grid of
    /// cells of `h` over the box: the particles sorted by cell (stably, by index), and each
    /// particle's 27 cells read as nine runs of three cells along x.
    fn neighbours(&mut self, p: &[Vec3], lo: Vec3, hi: Vec3, runner: &dyn Runner, chunks: usize) {
        let n = p.len();
        let h = self.h;
        let h2 = h * h;
        let ext = hi - lo;
        let dims = [
            (ext.x / h) as usize + 1,
            (ext.y / h) as usize + 1,
            (ext.z / h) as usize + 1,
        ];
        let cell = |q: Vec3| -> [usize; 3] {
            let g = (q - lo) * (1.0 / h);
            [
                (g.x.max(0.0) as usize).min(dims[0] - 1),
                (g.y.max(0.0) as usize).min(dims[1] - 1),
                (g.z.max(0.0) as usize).min(dims[2] - 1),
            ]
        };
        let index = |c: [usize; 3]| c[0] + dims[0] * (c[1] + dims[1] * c[2]);
        let cells = dims[0] * dims[1] * dims[2];
        let keys: Vec<u32> = p.iter().map(|&q| index(cell(q)) as u32).collect();
        let mut first = vec![0u32; cells + 1];
        for &k in &keys {
            first[k as usize + 1] += 1;
        }
        for i in 0..cells {
            first[i + 1] += first[i];
        }
        let mut fill = first.clone();
        let mut sorted = vec![0u32; n];
        for (i, &k) in keys.iter().enumerate() {
            sorted[fill[k as usize] as usize] = i as u32;
            fill[k as usize] += 1;
        }
        let rows = pass(runner, chunks, n, 40, |i, out| {
            let c = cell(p[i]);
            let at = out.len();
            out.push(0.0);
            let mut count = 0u32;
            let pi = p[i];
            let (x0, x1) = (c[0].saturating_sub(1), (c[0] + 1).min(dims[0] - 1));
            for z in c[2].saturating_sub(1)..=(c[2] + 1).min(dims[2] - 1) {
                for y in c[1].saturating_sub(1)..=(c[1] + 1).min(dims[1] - 1) {
                    let a = first[index([x0, y, z])] as usize;
                    let b = first[index([x1, y, z]) + 1] as usize;
                    for &j in &sorted[a..b] {
                        if j as usize != i && (p[j as usize] - pi).length_squared() < h2 {
                            out.push(f32::from_bits(j));
                            count += 1;
                        }
                    }
                }
            }
            out[at] = f32::from_bits(count);
        });
        self.start.clear();
        self.start.push(0);
        self.list.clear();
        let mut at = 0;
        while at < rows.len() {
            let count = rows[at].to_bits() as usize;
            self.list
                .extend(rows[at + 1..at + 1 + count].iter().map(|v| v.to_bits()));
            self.start.push(self.list.len() as u32);
            at += 1 + count;
        }
    }

    #[inline]
    fn of(&self, i: usize) -> &[u32] {
        &self.list[self.start[i] as usize..self.start[i + 1] as usize]
    }

    /// The walls of particle `i` (its planes in `contacts`): the distance of `q` from each.
    #[inline]
    fn planes(contacts: &[f32], i: usize) -> impl Iterator<Item = (Vec3, Vec3)> + '_ {
        let at = CONTACT_FLOATS * i;
        let k = contacts[at] as usize;
        (0..k).map(move |m| {
            let o = at + 1 + 6 * m;
            (v3(&contacts[o..], 0), v3(&contacts[o + 3..], 0))
        })
    }

    /// The wall's share of the density of a particle at `q` and its gradient, over the planes.
    fn wall_density(&self, contacts: &[f32], i: usize, q: Vec3) -> (f32, Vec3) {
        let mut share = 0.0f32;
        let mut grad = Vec3::ZERO;
        for (c, n) in Fluid::planes(contacts, i) {
            let (s, slope) = self.wall((q - c).dot(n).max(0.0));
            share += s;
            grad += n * slope;
        }
        (share, grad)
    }

    /// One substep of `dt` against `walls`.
    fn substep(&mut self, walls: &Walls, dt: f32, runner: &dyn Runner, chunks: usize) {
        let n = self.x.len();
        if n == 0 {
            return;
        }
        let h = self.h;
        let h2 = h * h;
        let n0 = self.n0;
        let gap = MIN_GAP * self.spacing;
        let params = self.params;
        let x = self.x.clone();
        if self.contacts.len() != n * CONTACT_FLOATS {
            self.contacts = pass(runner, chunks, n, CONTACT_FLOATS, |i, out| {
                walls.contacts(x[i], out)
            });
        }
        // Forces: gravity, and cohesion, surface tension and adhesion from the neighbours now.
        let shaped = params.cohesion != 0.0 || params.surface_tension != 0.0;
        let (density, normals) = if shaped {
            let dn = pass(runner, chunks, n, 4, |i, out| {
                let mut d = 1.0f32;
                let mut g = Vec3::ZERO;
                for &j in self.of(i) {
                    let dx = x[i] - x[j as usize];
                    let r2 = dx.length_squared();
                    d += w(r2, h2);
                    g += grad_w(dx, r2, h2);
                }
                out.push(d);
                // The colour field's normal, pointing out of the liquid.
                push3(out, g * (-h / n0));
            });
            let density: Vec<f32> = (0..n).map(|i| dn[4 * i]).collect();
            let normals: Vec<Vec3> = (0..n)
                .map(|i| Vec3::new(dn[4 * i + 1], dn[4 * i + 2], dn[4 * i + 3]))
                .collect();
            (density, normals)
        } else {
            (Vec::new(), Vec::new())
        };
        let contacts = &self.contacts;
        let accel = pass(runner, chunks, n, 3, |i, out| {
            let mut a = Vec3::new(0.0, 0.0, -GRAVITY);
            if shaped {
                let mut coh = Vec3::ZERO;
                let mut curv = Vec3::ZERO;
                for &j in self.of(i) {
                    let j = j as usize;
                    let dx = x[i] - x[j];
                    let r = dx.length();
                    if r <= 1.0e-9 {
                        continue;
                    }
                    let k = 2.0 * n0 / (density[i] + density[j]);
                    coh += dx * (k * cohesion_spline(r, h) / r);
                    curv += (normals[i] - normals[j]) * k;
                }
                a -= coh * (params.cohesion * GRAVITY / n0);
                a -= curv * (params.surface_tension * GRAVITY);
            }
            if params.adhesion != 0.0 {
                for (c, nrm) in Fluid::planes(contacts, i) {
                    let d = (x[i] - c).dot(nrm);
                    if (0.0..h).contains(&d) {
                        let f = 1.0 - d / h;
                        a -= nrm * (params.adhesion * GRAVITY * f * f);
                    }
                }
            }
            push3(out, a);
        });
        let vmax = MAX_SPEED * h / dt;
        let mut v = self.v.clone();
        let predicted = pass(runner, chunks, n, 6, |i, out| {
            let mut vi = v[i] + v3(&accel, i) * dt;
            let s = vi.length();
            if s > vmax {
                vi *= vmax / s;
            }
            push3(out, vi);
            push3(out, walls.sweep(x[i], x[i] + vi * dt, gap));
        });
        let mut p = vec![Vec3::ZERO; n];
        for i in 0..n {
            v[i] = v3(&predicted, 2 * i);
            p[i] = v3(&predicted, 2 * i + 1);
        }
        self.neighbours(&p, walls.lo, walls.hi, runner, chunks);
        // The walls near each predicted particle, as planes, for the iterations.
        let near = pass(runner, chunks, n, CONTACT_FLOATS, |i, out| {
            walls.contacts(p[i], out)
        });
        let max_move = 0.25 * h;
        // The density iterations.
        for _ in 0..ITERATIONS {
            // λ of every particle, and the kernel's gradient of each of its pairs for the move.
            let solved = pass(runner, chunks, n, 1 + 3 * 32, |i, out| {
                let mut density = 1.0f32;
                let mut gi = Vec3::ZERO;
                let mut sum2 = 0.0f32;
                let at = out.len();
                out.push(0.0);
                let pi = p[i];
                for &j in self.of(i) {
                    let dx = pi - p[j as usize];
                    let r2 = dx.length_squared();
                    let g = if r2 < h2 {
                        let q = 1.0 - r2 / h2;
                        density += q * q * q;
                        dx * (-6.0 * q * q / h2)
                    } else {
                        Vec3::ZERO
                    };
                    push3(out, g);
                    gi += g;
                    sum2 += g.length_squared();
                }
                let (share, slope) = self.wall_density(&near, i, pi);
                density += share;
                gi += slope;
                let c = density / n0 - 1.0;
                out[at] = if c > 0.0 {
                    -c / ((gi.length_squared() + sum2) / (n0 * n0) + self.eps)
                } else {
                    0.0
                };
            });
            let mut lambda = vec![0.0f32; n];
            let mut grads = vec![0.0f32; 3 * self.list.len()];
            let mut at = 0;
            for (i, l) in lambda.iter_mut().enumerate() {
                let (a, b) = (self.start[i] as usize, self.start[i + 1] as usize);
                *l = solved[at];
                grads[3 * a..3 * b].copy_from_slice(&solved[at + 1..at + 1 + 3 * (b - a)]);
                at += 1 + 3 * (b - a);
            }
            let moved = pass(runner, chunks, n, 3, |i, out| {
                let li = lambda[i];
                let mut dp = Vec3::ZERO;
                let a = self.start[i] as usize;
                for (k, &j) in self.of(i).iter().enumerate() {
                    dp += v3(&grads, a + k) * (li + lambda[j as usize]);
                }
                if li != 0.0 {
                    dp += self.wall_density(&near, i, p[i]).1 * li;
                }
                let mut dp = dp * (1.0 / n0);
                let len = dp.length();
                if len > max_move {
                    dp *= max_move / len;
                }
                // Never through a wall, and no closer to one than the gap.
                let mut q = p[i] + dp;
                for (c, nrm) in Fluid::planes(&near, i) {
                    let d = (q - c).dot(nrm);
                    if d < gap {
                        q += nrm * (gap - d);
                    }
                }
                walls.clamp(&mut q, gap);
                push3(out, q);
            });
            for (i, pi) in p.iter_mut().enumerate() {
                *pi = v3(&moved, i);
            }
        }
        // Velocities from the positions, then XSPH and the walls' drag.
        let inv = 1.0 / dt;
        for i in 0..n {
            v[i] = (p[i] - x[i]) * inv;
        }
        // Viscosity, implicitly: `v = v₀ + α (v̄ − v)` by Jacobi iterations, `v̄` the kernel's
        // average of the neighbours' velocities and the particle's own, the walls in it as still
        // neighbours of their share (so the liquid does not slip along them), and
        // `α = 22 ν Δt / h²` (the average of a smooth field differs from it by `h²/22` of its
        // Laplacian for this kernel), plus XSPH's smoothing.
        let alpha = 22.0 * params.viscosity.max(0.0) * dt / h2 + XSPH;
        // A stiffer system needs more rounds to spread: about α of them.
        let rounds = (alpha.ceil() as u32).clamp(1, MAX_VISCOUS_ITERATIONS);
        let start = v.clone();
        for _ in 0..rounds {
            let blended = pass(runner, chunks, n, 3, |i, out| {
                let mut sum = v[i];
                let mut weight = 1.0f32;
                for &j in self.of(i) {
                    let j = j as usize;
                    let wij = w((p[i] - p[j]).length_squared(), h2);
                    sum += v[j] * wij;
                    weight += wij;
                }
                weight += self.wall_density(&near, i, p[i]).0;
                let mean = sum * (1.0 / weight);
                push3(out, (start[i] + mean * alpha) * (1.0 / (1.0 + alpha)));
            });
            for (i, vi) in v.iter_mut().enumerate() {
                *vi = v3(&blended, i);
            }
        }
        self.x = p;
        self.v = v;
        self.contacts = near;
    }
}

// ------------------------------------------------------------------ the world

/// The liquids of a scene and their walls.
#[derive(Clone, Debug)]
pub struct LiquidWorld {
    walls: Walls,
    fluids: Vec<Fluid>,
    steps: u64,
    workers: usize,
}

impl LiquidWorld {
    /// Builds the world of a scene: each liquid's part filled with particles, the static parts
    /// and the floor as its walls, in a box around the liquid.
    pub fn new(spec: &LiquidSpec) -> LiquidWorld {
        let mut fluids = Vec::new();
        let mut total = 0usize;
        for l in &spec.liquids {
            let mesh = &spec.meshes[l.mesh as usize];
            let world: Vec<Vec3> = mesh
                .positions
                .iter()
                .map(|p| l.transform.apply(*p))
                .collect();
            let (mut points, spacing) = fill::fill(&world, &mesh.indices, l.spacing);
            points.truncate(MAX_PARTICLES.saturating_sub(total));
            total += points.len();
            fluids.push(Fluid::new(points, spacing, l.params));
        }
        // The box: the liquid's, grown by its size (at least DOMAIN_MIN_SPACINGS spacings), down
        // to the floor.
        let mut lo = Vec3::splat(f32::MAX);
        let mut hi = Vec3::splat(f32::MIN);
        let mut spacing = 0.0f32;
        let mut h = 0.0f32;
        for f in &fluids {
            for p in &f.x {
                lo = lo.min(*p);
                hi = hi.max(*p);
            }
            spacing = spacing.max(f.spacing);
            h = h.max(f.h);
        }
        if total == 0 {
            lo = Vec3::ZERO;
            hi = Vec3::ONE;
            spacing = 1.0;
            h = SMOOTHING;
        }
        let size = (hi - lo).max_component();
        let margin = (DOMAIN_MARGIN * size).max(DOMAIN_MIN_SPACINGS * spacing);
        let mut dlo = lo - Vec3::splat(margin);
        let mut dhi = hi + Vec3::splat(margin);
        // Grown to hold the containers it touches (a tank wider than the liquid), within
        // DOMAIN_REACH times the margin.
        let (rlo, rhi) = (
            lo - Vec3::splat(DOMAIN_REACH * margin),
            hi + Vec3::splat(DOMAIN_REACH * margin),
        );
        let (elo, ehi) = (dlo, dhi);
        for st in &spec.statics {
            let mesh = &spec.meshes[st.mesh as usize];
            for t in mesh.indices.chunks_exact(3) {
                let v = [0, 1, 2].map(|k| st.transform.apply(mesh.positions[t[k] as usize]));
                if !v.iter().all(|p| p.is_finite()) {
                    continue;
                }
                let (tlo, thi) = (v[0].min(v[1]).min(v[2]), v[0].max(v[1]).max(v[2]));
                let touches = tlo.x <= ehi.x
                    && tlo.y <= ehi.y
                    && tlo.z <= ehi.z
                    && thi.x >= elo.x
                    && thi.y >= elo.y
                    && thi.z >= elo.z;
                if touches {
                    dlo = dlo.min(tlo.max(rlo));
                    dhi = dhi.max(thi.min(rhi));
                }
            }
        }
        if let Some(z) = spec.floor {
            if z < lo.z {
                dlo.z = z - spacing;
            }
        }
        let mut walls = Walls {
            tris: Vec::new(),
            cells: Vec::new(),
            lo: dlo,
            hi: dhi,
            cell: h,
            dims: [0; 3],
            floor: spec.floor,
        };
        let ext = dhi - dlo;
        walls.dims = [
            ((ext.x / h) as u32 + 1).max(1),
            ((ext.y / h) as u32 + 1).max(1),
            ((ext.z / h) as u32 + 1).max(1),
        ];
        for s in &spec.statics {
            let mesh = &spec.meshes[s.mesh as usize];
            for t in mesh.indices.chunks_exact(3) {
                let v = [0, 1, 2].map(|k| s.transform.apply(mesh.positions[t[k] as usize]));
                let n = (v[1] - v[0]).cross(v[2] - v[0]);
                if !crate::math::above(n.length(), 0.0) || !v.iter().all(|p| p.is_finite()) {
                    continue;
                }
                let tlo = v[0].min(v[1]).min(v[2]) - Vec3::splat(h);
                let thi = v[0].max(v[1]).max(v[2]) + Vec3::splat(h);
                if thi.x < dlo.x || thi.y < dlo.y || thi.z < dlo.z {
                    continue;
                }
                if tlo.x > dhi.x || tlo.y > dhi.y || tlo.z > dhi.z {
                    continue;
                }
                let index = walls.tris.len() as u32;
                let (lo, hi) = (v[0].min(v[1]).min(v[2]), v[0].max(v[1]).max(v[2]));
                walls.tris.push(Tri {
                    v,
                    n: n.normalize(),
                    lo,
                    hi,
                });
                let g = |p: Vec3, k: usize| {
                    let c = (match k {
                        0 => p.x - dlo.x,
                        1 => p.y - dlo.y,
                        _ => p.z - dlo.z,
                    } / h)
                        .floor();
                    (c.max(0.0) as u32).min(walls.dims[k] - 1)
                };
                for z in g(tlo, 2)..=g(thi, 2) {
                    for y in g(tlo, 1)..=g(thi, 1) {
                        for x in g(tlo, 0)..=g(thi, 0) {
                            let c = x + walls.dims[0] * (y + walls.dims[1] * z);
                            walls.cells.push((c, index));
                        }
                    }
                }
            }
        }
        walls.cells.sort_unstable();
        LiquidWorld {
            walls,
            fluids,
            steps: 0,
            workers: 1,
        }
    }

    /// Splits every pass into `n` chunks, as `n` threads would (the result does not change).
    pub fn set_workers(&mut self, n: usize) {
        self.workers = n.max(1);
    }

    /// Simulates `n` steps of 1/240 s, the chunks one after another.
    pub fn step(&mut self, n: u32) {
        self.step_with(n, &Serial);
    }

    /// Simulates `n` steps, the chunks of each pass run by `runner`.
    pub fn step_with(&mut self, n: u32, runner: &dyn Runner) {
        let dt = crate::world::STEP / SUBSTEPS as f32;
        for _ in 0..n {
            for f in &mut self.fluids {
                if self.steps == 0 && f.list.is_empty() {
                    let x = f.x.clone();
                    f.neighbours(&x, self.walls.lo, self.walls.hi, runner, self.workers);
                }
                for _ in 0..SUBSTEPS {
                    f.substep(&self.walls, dt, runner, self.workers);
                }
            }
            self.steps += 1;
        }
    }

    /// Steps simulated.
    pub fn steps(&self) -> u64 {
        self.steps
    }

    /// The number of liquids.
    pub fn liquids(&self) -> usize {
        self.fluids.len()
    }

    /// The particles of liquid `i`.
    pub fn particles(&self, i: usize) -> &[Vec3] {
        self.fluids.get(i).map_or(&[], |f| &f.x)
    }

    /// The velocities of liquid `i`'s particles, mm/s.
    pub fn velocities(&self, i: usize) -> &[Vec3] {
        self.fluids.get(i).map_or(&[], |f| &f.v)
    }

    /// The particle spacing of liquid `i`, mm (what the fill used).
    pub fn spacing(&self, i: usize) -> f32 {
        self.fluids.get(i).map_or(0.0, |f| f.spacing)
    }

    /// The box around the liquid that keeps it, and the frames' quantisation box.
    pub fn domain(&self) -> (Vec3, Vec3) {
        (self.walls.lo, self.walls.hi)
    }

    /// Every particle of every liquid.
    pub fn particle_count(&self) -> usize {
        self.fluids.iter().map(|f| f.x.len()).sum()
    }

    /// FNV-1a of every particle's position and velocity, liquid by liquid.
    pub fn hash(&self) -> u32 {
        let mut h: u32 = 0x811c_9dc5;
        for f in &self.fluids {
            for (p, v) in f.x.iter().zip(&f.v) {
                for c in [p.x, p.y, p.z, v.x, v.y, v.z] {
                    for byte in c.to_le_bytes() {
                        h ^= byte as u32;
                        h = h.wrapping_mul(0x0100_0193);
                    }
                }
            }
        }
        h
    }

    /// The record of liquid `i` now (`LQF1`, see [`frame_bytes`]).
    pub fn frame(&self, i: usize) -> Vec<u8> {
        let (lo, hi) = self.domain();
        frame_bytes(self.particles(i), self.spacing(i), lo, hi)
    }

    /// The surface of liquid `i` now, as the page draws it: rebuilt from its frame record.
    pub fn surface(&self, i: usize) -> surface::SurfaceMesh {
        mesh_from_frame(&self.frame(i)).unwrap_or_default()
    }
}

/// The bytes of a frame record: `"LQF1"`, `u32` particles, `f32` spacing, `f32` box low[3] and
/// high[3], then each particle as three `u16` (its place in the box, in 65535ths), zero padding
/// to a multiple of 12 bytes (so a run of records is whole groups of base64).
pub fn frame_bytes(points: &[Vec3], spacing: f32, lo: Vec3, hi: Vec3) -> Vec<u8> {
    let mut out = Vec::with_capacity(frame_len(points.len()));
    out.extend_from_slice(FRAME_MAGIC);
    out.extend_from_slice(&(points.len() as u32).to_le_bytes());
    for v in [spacing, lo.x, lo.y, lo.z, hi.x, hi.y, hi.z] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    let size = hi - lo;
    let q = |v: f32, lo: f32, size: f32| -> u16 {
        if !crate::math::above(size, 0.0) {
            return 0;
        }
        ((v - lo) / size * 65535.0 + 0.5).clamp(0.0, 65535.0) as u16
    };
    for p in points {
        for (v, l, s) in [
            (p.x, lo.x, size.x),
            (p.y, lo.y, size.y),
            (p.z, lo.z, size.z),
        ] {
            out.extend_from_slice(&q(v, l, s).to_le_bytes());
        }
    }
    out.resize(frame_len(points.len()), 0);
    out
}

/// The length of a frame record of `n` particles.
pub fn frame_len(n: usize) -> usize {
    (FRAME_HEADER + 6 * n).div_ceil(12) * 12
}

/// The particles of a frame record and their spacing.
pub fn read_frame(bytes: &[u8]) -> Result<(Vec<Vec3>, f32), String> {
    if bytes.len() < FRAME_HEADER || &bytes[..4] != FRAME_MAGIC {
        return Err("LQF1: not a liquid frame".into());
    }
    let word = |i: usize| [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
    let n = u32::from_le_bytes(word(4)) as usize;
    if bytes.len() != frame_len(n) {
        return Err(format!("LQF1: {} bytes for {n} particles", bytes.len()));
    }
    let f = |i: usize| f32::from_le_bytes(word(8 + 4 * i));
    let spacing = f(0);
    let lo = Vec3::new(f(1), f(2), f(3));
    let hi = Vec3::new(f(4), f(5), f(6));
    if !(spacing > 0.0 && spacing.is_finite() && lo.is_finite() && hi.is_finite()) {
        return Err("LQF1: a spacing or a box that is not usable".into());
    }
    let step = (hi - lo) * (1.0 / 65535.0);
    let mut points = Vec::with_capacity(n);
    for k in 0..n {
        let at = FRAME_HEADER + 6 * k;
        let q = |o: usize| u16::from_le_bytes([bytes[at + o], bytes[at + o + 1]]) as f32;
        points.push(Vec3::new(
            lo.x + q(0) * step.x,
            lo.y + q(2) * step.y,
            lo.z + q(4) * step.z,
        ));
    }
    Ok((points, spacing))
}

/// The surface of a frame record, by marching cubes ([`surface::surface`]).
pub fn mesh_from_frame(bytes: &[u8]) -> Result<surface::SurfaceMesh, String> {
    let (points, spacing) = read_frame(bytes)?;
    Ok(surface::surface(&points, spacing))
}

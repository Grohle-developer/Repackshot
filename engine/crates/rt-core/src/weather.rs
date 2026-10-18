//! Rain, dust and snow on the parts (phase S3c) as the renderer shades them: the RSB `WETP`
//! section, one per wet instance, which the page writes from the frame of a recorded simulation
//! (`rt_phys::wet_parts`) that the pose shows.
//!
//! **The samples.** Every triangle of the instance's mesh carries a grid of `R` steps per side
//! (its `resolution`, 1 to [`MAX_RESOLUTION`]): the samples `(i, j)`, `i + j ≤ R`, at the
//! barycentric weights `(1 − (i + j)/R, i/R, j/R)` of its corners, row `j` after row `j − 1`
//! ([`sample_index`]). Each holds three bytes: wet (0..255 for 0..1), the share under dust (0..255
//! for 0..1) and the depth of snow ([`SNOW_STEP_MM`] per step). A hit reads them linearly over the
//! small triangle of the grid it falls in, so neighbouring samples blend and the edges of a trail
//! are as soft as the grid.
//!
//! **The layers** ([`weathered`], a proposal for the lead's verdict: rule 11, ◆ in the roadmap's
//! S3c). Over the material as its patterns, program and textures leave it, from the bottom up:
//! **dust** mixes the surface towards a dry grey dust ([`DUST_ALBEDO`], rough, not metal, not clear),
//! darker where it is wet; **wet** is a film of water: a smooth clear coat over everything
//! ([`WET_COAT_ROUGHNESS`]), and a porous material (the instance's `porosity`, from the family of its
//! material) darker, its albedo raised to `1 + wet × porosity × WET_DARKEN` (Lekner and Dorf, "Why
//! some things are darker when wet", Applied Optics 27 (1988): the water in the pores lets less
//! light back out); **snow** covers it with a white, rough, diffuse layer as it gets deeper
//! (`1 − e^(−depth / SNOW_COVER_MM)`). Where all three are 0 the material is not touched: an
//! instance without water, dust or snow renders bit for bit as without the section.
//!
//! **The drops** are caps of water: each a part of the sphere of radius `a / sin θ` cut by the
//! tangent plane of its point on the surface, at the contact angle `θ` of the instance, its
//! contact circle of radius `a`. The reader meshes them all ([`cap_mesh`]: [`CAP_SEGMENTS`] around
//! by [`CAP_RINGS`] rings, the sphere's normals) in world space as one more mesh, with one more
//! instance and one more material (water, [`water`]) after the file's: the instance index of a drop
//! in the part and material passes is the file's instances' count (the particles of the ambient
//! effects come after it). The caps are crossed straight by shadow rays, as the small clear
//! particles of S4b are, so a drop does not cast a black disc on the surface under it.
//!
//! **S3d.** In the part and material passes a drop counts as the instance it lies on (its part),
//! not as the caps' instance ([`crate::scene::Scene::pass_instance`]). The drops **in the air** (a
//! drip falling, the drops a splash threw: the `WETF` section, [`FallingDrop`]) are spheres of
//! water in world space, meshed in the same mesh after the caps ([`SPHERE_SEGMENTS`] around by
//! [`SPHERE_RINGS`] bands), with the same water and the same straight shadows, and in the passes
//! each counts as the instance it left.
//!
//! **S3f: organic drops.** A `WETP` section may end in a **shape tail** ([`SHAPE_TAG`], then one
//! [`DropShape`] per drop): what the simulation says each drop looks like, from its velocity, its
//! contact angles, the tilt of its face and its volume. A drop is then a **deformed cap**
//! ([`shape_point`]): the round cap sheared downhill by the difference of its front and rear contact
//! angles (a pinned drop on a tilted face bulges downhill), stretched along its motion with a
//! thinner tail (a sliding drop), stretched along the line to the drop it just merged with and
//! pinched in the middle (the neck of two drops that merge), and stretched along gravity with a
//! neck under its contact line (a drop that hangs and pinches off). Each step keeps its volume (the
//! stretches are area-preserving or compensated in height, exactly for a paraboloid). A section with
//! a tail is meshed finer ([`SHAPED_CAP_RINGS`]) and the deformed caps get the normals of their
//! faces; an engine of before ignores the tail (trailing bytes) and draws round caps (bit 10 of the
//! features, [`crate::FEATURE_WET_SHAPES`]).

use crate::color::Rgb;
use crate::fmath;
use crate::geometry::{Hit, Mesh};
use crate::math::Vec3;
use crate::scene::{Material, Scene, MATERIAL_EMISSIVE, MATERIAL_GLASS};

/// The bytes of a `WETP` section's header.
pub const WETP_HEADER: usize = 24;
/// Most steps of a triangle's grid per side in a `WETP` section (one byte).
pub const MAX_RESOLUTION: u32 = 255;
/// S3e: most steps of a triangle's grid per side in a `WTP2` section (two bytes: the set's fine
/// samples, where a shadow edge crosses a large triangle).
pub const MAX_FINE_RESOLUTION: u32 = 4095;
/// S3e: the tag of the motes tail of a `WETP` or `WTP2` section.
pub const MOTE_TAG: [u8; 4] = *b"MOT1";
/// S3e: the dust share of a sample above which grains show over the layer (◆).
pub const MOTE_THRESHOLD: f32 = 0.3;
/// S3e: the share of the grains a sample's dust stands for that are drawn one by one (◆): the
/// layer is the rest.
pub const MOTE_SHARE: f32 = 0.02;
/// S3e: most motes of all the instances together (◆: each is a grain the reader meshes).
pub const MAX_MOTES: usize = 20_000;
/// S3e: triangles of a mote (an octahedron).
pub const MOTE_TRIANGLES: u32 = 8;
/// S3e: the bytes of a `WETG` section's header.
pub const WETG_HEADER: usize = 32;
/// S3e: most cells of the studio floor.
pub const MAX_FLOOR_CELLS: u32 = 4_000_000;
/// S3e: the reflectance of water at normal incidence, `((n − 1)/(n + 1))²` for `n` = 1.333.
pub const WATER_F0: f32 = 0.020_4;
/// Most drops of all the instances together.
pub const MAX_WET_DROPS: usize = 4096;
/// The depth of snow one step of its byte stands for, mm (255 steps: 5.1 mm).
pub const SNOW_STEP_MM: f32 = 0.02;
/// The depth of snow that covers 63 % of a surface, mm (◆).
pub const SNOW_COVER_MM: f32 = 0.5;
/// The roughness of the film of water on a wet surface (◆).
pub const WET_COAT_ROUGHNESS: f32 = 0.03;
/// How much darker a soaked porous albedo gets: its exponent grows by this at full wetness (◆).
pub const WET_DARKEN: f32 = 1.0;
/// The colour of dry dust, linear (◆: a light, warm grey).
pub const DUST_ALBEDO: Rgb = Rgb::new(0.42, 0.39, 0.35);
/// The roughness of a surface under dust (◆).
pub const DUST_ROUGHNESS: f32 = 0.9;
/// The albedo of snow (◆).
pub const SNOW_ALBEDO: f32 = 0.9;
/// The roughness of snow (◆).
pub const SNOW_ROUGHNESS: f32 = 0.85;
/// The index of refraction of water.
pub const WATER_IOR: f32 = 1.333;
/// Segments around a drop's cap.
pub const CAP_SEGMENTS: u32 = 16;
/// Rings of a drop's cap from its top to its contact circle.
pub const CAP_RINGS: u32 = 4;
/// Triangles of a drop's cap.
pub const CAP_TRIANGLES: u32 = CAP_SEGMENTS * (2 * CAP_RINGS - 1);
/// S3d: segments around a drop in the air (a sphere).
pub const SPHERE_SEGMENTS: u32 = 12;
/// S3d: bands of a drop in the air from pole to pole.
pub const SPHERE_RINGS: u32 = 6;
/// S3d: triangles of a drop in the air.
pub const SPHERE_TRIANGLES: u32 = 2 * SPHERE_SEGMENTS * (SPHERE_RINGS - 1);
/// S3d: the bytes of a `WETF` section's header (its count).
pub const WETF_HEADER: usize = 4;
/// S3d: the bytes of a drop in the air in a `WETF` section.
pub const WETF_DROP_BYTES: usize = 20;
/// S3d: most drops in the air of a scene.
pub const MAX_FALLING_DROPS: usize = 4096;
/// S3d: the instance of a drop in the air that left no instance of the file.
pub const NO_INSTANCE: u32 = u32::MAX;
/// S3f: the tag of the shape tail of a `WETP` section.
pub const SHAPE_TAG: [u8; 4] = *b"SHP1";
/// S3f: the floats of a drop's shape in the tail.
pub const SHAPE_FLOATS: usize = 15;
/// S3f: segments around a shaped cap (as a round one).
pub const SHAPED_CAP_SEGMENTS: u32 = 16;
/// S3f: rings of a shaped cap from its top to its contact circle (twice a round one's: a neck
/// needs them).
pub const SHAPED_CAP_RINGS: u32 = 8;
/// S3f: triangles of a shaped cap.
pub const SHAPED_CAP_TRIANGLES: u32 = SHAPED_CAP_SEGMENTS * (2 * SHAPED_CAP_RINGS - 1);
/// S3f: the share of a paraboloid cap's volume that a neck of depth 1 takes from its width
/// (`∫∫ h (1 − x²)² dA / ∫∫ h dA = 35/48` over the unit disc, `h = 1 − ρ²`).
pub const NECK_VOLUME: f32 = 35.0 / 48.0;

/// S3f: how a drop on a part is deformed from its round cap (the shape tail of `WETP`). The axes are
/// in the instance's object space and need not be unit or tangent: the reader projects them onto the
/// tangent plane of the drop's point; a zero axis leaves out what goes with it.
///
/// ```text
/// f32 axis[3] aspect bulge taper  merge_axis[3] merge_along merge_across neck shift  sag pinch
/// ```
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DropShape {
    /// The direction of its motion, or downhill for a pinned drop.
    pub axis: Vec3,
    /// Its length over its width along `axis`, 1..16 (the contact area kept).
    pub aspect: f32,
    /// How far its top is sheared along `axis`, in contact radii, −2..2.
    pub bulge: f32,
    /// Wider at its head (along `axis`) and thinner at its tail by this, −0.95..0.95.
    pub taper: f32,
    /// The line from where it was to the drop it merged with.
    pub merge_axis: Vec3,
    /// Its stretch along `merge_axis` and across it, 0.1..16 (its height keeps the volume).
    pub merge_along: f32,
    /// See [`DropShape::merge_along`].
    pub merge_across: f32,
    /// The depth of the neck between the two, 0..0.95.
    pub neck: f32,
    /// How far its outline is off its centre along `merge_axis`, in contact radii, −16..16.
    pub shift: f32,
    /// How much it stretches along gravity (hanging), 0..8: thinner across by up to `√(1 + sag)`
    /// at its top, longer along gravity by what keeps its volume (S3g: its contact line stays).
    pub sag: f32,
    /// The neck of a hanging drop under its contact line, 0..0.95.
    pub pinch: f32,
}

impl DropShape {
    /// A round cap.
    pub const ROUND: DropShape = DropShape {
        axis: Vec3::ZERO,
        aspect: 1.0,
        bulge: 0.0,
        taper: 0.0,
        merge_axis: Vec3::ZERO,
        merge_along: 1.0,
        merge_across: 1.0,
        neck: 0.0,
        shift: 0.0,
        sag: 0.0,
        pinch: 0.0,
    };

    /// Its floats, in the order of the tail.
    pub fn to_floats(&self) -> [f32; SHAPE_FLOATS] {
        [
            self.axis.x,
            self.axis.y,
            self.axis.z,
            self.aspect,
            self.bulge,
            self.taper,
            self.merge_axis.x,
            self.merge_axis.y,
            self.merge_axis.z,
            self.merge_along,
            self.merge_across,
            self.neck,
            self.shift,
            self.sag,
            self.pinch,
        ]
    }

    /// The shape of floats in the order of the tail.
    pub fn from_floats(f: [f32; SHAPE_FLOATS]) -> DropShape {
        DropShape {
            axis: Vec3::new(f[0], f[1], f[2]),
            aspect: f[3],
            bulge: f[4],
            taper: f[5],
            merge_axis: Vec3::new(f[6], f[7], f[8]),
            merge_along: f[9],
            merge_across: f[10],
            neck: f[11],
            shift: f[12],
            sag: f[13],
            pinch: f[14],
        }
    }

    /// True when every value is finite and in its range.
    pub fn is_valid(&self) -> bool {
        let axis = |v: Vec3| v.is_finite() && v.abs().max_component() <= 1.0e6;
        axis(self.axis)
            && axis(self.merge_axis)
            && (1.0..=16.0).contains(&self.aspect)
            && (-2.0..=2.0).contains(&self.bulge)
            && (-0.95..=0.95).contains(&self.taper)
            && (0.1..=16.0).contains(&self.merge_along)
            && (0.1..=16.0).contains(&self.merge_across)
            && (0.0..=0.95).contains(&self.neck)
            && (-16.0..=16.0).contains(&self.shift)
            && (0.0..=8.0).contains(&self.sag)
            && (0.0..=0.95).contains(&self.pinch)
    }

    /// True when it is a round cap.
    pub fn is_round(&self) -> bool {
        *self == DropShape::ROUND
    }

    /// The same shape with its axes carried by `f` (object to world: the linear part).
    pub fn map_axes(&self, f: impl Fn(Vec3) -> Vec3) -> DropShape {
        DropShape {
            axis: f(self.axis),
            merge_axis: f(self.merge_axis),
            ..*self
        }
    }
}

/// S3f: the frame a cap is deformed in (world): its surface normal, its unit tangent axes and their
/// normals in the plane (none for a zero axis), its contact radius and height, and gravity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShapeFrame {
    /// Unit normal of the surface.
    pub n: Vec3,
    /// The drop's axis and its normal in the plane.
    pub axis: Option<(Vec3, Vec3)>,
    /// The merge's axis and its normal in the plane.
    pub merge: Option<(Vec3, Vec3)>,
    /// Contact radius, mm.
    pub a: f32,
    /// Height of the round cap, mm.
    pub h: f32,
    /// Unit gravity (`−Z`).
    pub g: Vec3,
}

impl ShapeFrame {
    /// The frame of `shape` (its axes in world space) on a cap of normal `n`, contact radius `a`
    /// and contact angle `angle_deg`.
    pub fn new(n: Vec3, shape: &DropShape, a: f32, angle_deg: f32) -> ShapeFrame {
        let tangent = |v: Vec3| {
            let t = v - n * v.dot(n);
            let len = t.length();
            (len > 1.0e-6 && len.is_finite()).then(|| {
                let e = t / len;
                (e, n.cross(e))
            })
        };
        let theta = angle_deg.clamp(1.0, 179.0) * fmath::DEG_TO_RAD;
        let (st, ct) = fmath::sin_cos(theta);
        ShapeFrame {
            n,
            axis: tangent(shape.axis),
            merge: tangent(shape.merge_axis),
            a,
            h: a / st * (1.0 - ct),
            g: Vec3::new(0.0, 0.0, -1.0),
        }
    }
}

/// S3f: where the point `q` of a round cap (relative to the centre of its contact circle, world)
/// goes under `shape` in frame `f`, in this order: the shear of its top by `bulge` (in contact radii
/// at the top, none at the contact line), the taper of its width along the axis, the stretch along
/// the axis by `√aspect` and across by its inverse; the merge's stretch, its neck
/// (`1 − neck (1 − u²)²` of the width at `u` along the merge's axis) and shift, its height scaled
/// to keep the volume; S3g: the stretch along gravity of a hanging drop, the plane across it thinner
/// from none at its contact line (which stays where it is) to `√(1 + sag)` at its top, linearly in
/// the height share `t`, and pinched by `pinch · 4t(1 − t)`, the stretch along gravity what keeps the
/// volume ([`hang_stretch`]). Every step keeps the volume of a paraboloid cap.
pub fn shape_point(q: Vec3, f: &ShapeFrame, s: &DropShape) -> Vec3 {
    let a = f.a.max(1.0e-6);
    let z0 = q.dot(f.n);
    let t = if f.h > 0.0 {
        (z0 / f.h).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let mut q = q;
    if let Some((e, w)) = f.axis {
        let x0 = q.dot(e) / a;
        let y0 = q.dot(w) / a;
        let x = x0 + s.bulge * t;
        let y = y0 * (1.0 + s.taper * x0.clamp(-1.0, 1.0));
        let st = s.aspect.max(1.0).sqrt();
        q = (e * (x * st) + w * (y / st)) * a + f.n * z0;
    }
    if let Some((e, w)) = f.merge {
        let xm = q.dot(e) / a;
        let ym = q.dot(w) / a;
        let z = q.dot(f.n);
        let u = xm.clamp(-1.0, 1.0);
        let k = 1.0 - u * u;
        let pinch = 1.0 - s.neck * k * k;
        let keep = s.merge_along * s.merge_across * (1.0 - NECK_VOLUME * s.neck);
        let z = if keep > 0.0 { z / keep } else { z };
        q = (e * (xm * s.merge_along + s.shift) + w * (ym * s.merge_across * pinch)) * a + f.n * z;
    }
    if s.sag > 0.0 || s.pinch > 0.0 {
        let (b, c, kt) = hang_stretch(s);
        let par = q.dot(f.g);
        let perp = q - f.g * par;
        let across = (1.0 - c * 4.0 * t * (1.0 - t)) * (1.0 + b * t);
        q = f.g * (par * kt) + perp * across;
    }
    q
}

/// S3g: the hanging step of [`shape_point`] for `shape`: `b = 1/√(1 + sag) − 1` (the thinning across
/// gravity at the top of the cap: `1 + b t` at height share `t`), the pinch `c` and the stretch
/// along gravity that keeps the volume of a paraboloid cap, `1 / ∫₀¹ 2(1 − t) w(t)² dt` with
/// `w = (1 − 4c t(1 − t))(1 + b t)`:
/// `(1 − 4c/3 + 8c²/15) + b(2/3 − 16c/15 + 16c²/35) + b²(1/6 − 4c/15 + 4c²/35)` under the line.
pub fn hang_stretch(shape: &DropShape) -> (f32, f32, f32) {
    let k = 1.0 + shape.sag.max(0.0);
    let c = shape.pinch.clamp(0.0, 0.95);
    let b = 1.0 / k.sqrt() - 1.0;
    let i = (1.0 - 4.0 * c / 3.0 + 8.0 * c * c / 15.0)
        + b * (2.0 / 3.0 - 16.0 * c / 15.0 + 16.0 * c * c / 35.0)
        + b * b * (1.0 / 6.0 - 4.0 * c / 15.0 + 4.0 * c * c / 35.0);
    (b, c, if i > 0.0 { 1.0 / i } else { 1.0 })
}

/// S3g: the area of the outline of a cap in frame `f` deformed by `shape` (where its contact line
/// meets the surface), mm²: the polygon of `points` points of its round contact circle moved by
/// [`shape_point`] and projected onto the tangent plane, over the polygon of the round circle's own
/// points, times `π a²` (so a deformation that keeps areas gives `π a²` whatever the points).
pub fn outline_area(f: &ShapeFrame, shape: &DropShape, points: u32) -> f32 {
    let a = f.a.max(0.0);
    let n = points.max(3);
    // A tangent basis: the world axis least along the normal, crossed with it.
    let pick = if f.n.x.abs() <= f.n.y.abs() && f.n.x.abs() <= f.n.z.abs() {
        Vec3::new(1.0, 0.0, 0.0)
    } else if f.n.y.abs() <= f.n.z.abs() {
        Vec3::new(0.0, 1.0, 0.0)
    } else {
        Vec3::new(0.0, 0.0, 1.0)
    };
    let e1 = f.n.cross(pick).normalize();
    let e2 = f.n.cross(e1);
    let mut area = 0.0f32;
    let mut prev: Option<(f32, f32)> = None;
    let mut first = (0.0, 0.0);
    for k in 0..n {
        let phi = 2.0 * fmath::PI * k as f32 / n as f32;
        let (s, c) = fmath::sin_cos(phi);
        let p = shape_point((e1 * c + e2 * s) * a, f, shape);
        let here = (p.dot(e1), p.dot(e2));
        match prev {
            Some((x, y)) => area += x * here.1 - here.0 * y,
            None => first = here,
        }
        prev = Some(here);
    }
    if let Some((x, y)) = prev {
        area += x * first.1 - first.0 * y;
    }
    let round = 0.5 * n as f32 * fmath::sin(2.0 * fmath::PI / n as f32);
    if round > 0.0 {
        0.5 * area.abs() / round * fmath::PI
    } else {
        0.0
    }
}

/// The index of sample `(i, j)` of a triangle of resolution `r` among its samples (the order of
/// `rt_phys::wet_parts`).
pub fn sample_index(r: u32, i: u32, j: u32) -> u32 {
    j * (r + 1) - j * j.saturating_sub(1) / 2 + i
}

/// Samples of a triangle of resolution `r`.
pub fn samples_of(r: u32) -> u32 {
    (r + 1) * (r + 2) / 2
}

/// A drop of water on an instance: on its mesh's triangle `triangle`, at `position` (the instance's
/// object space), contact radius `radius` mm.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WetDrop {
    /// Its triangle in the mesh.
    pub triangle: u32,
    /// Its centre on the surface, object space.
    pub position: Vec3,
    /// Its contact radius, mm.
    pub radius: f32,
}

/// S3d: a drop of water in the air (a drip, a splash's drop): a sphere at `position` (world space)
/// of `radius` mm, which left instance `instance` (or [`NO_INSTANCE`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FallingDrop {
    /// The instance it left (its index among the `INST` sections), or [`NO_INSTANCE`].
    pub instance: u32,
    /// Its centre, world space.
    pub position: Vec3,
    /// Its radius, mm.
    pub radius: f32,
}

/// S3d: the drops in the air of a scene, the payload of its `WETF` section (at most one):
///
/// ```text
/// off  type  field
///   0  u32   drops
///   4        (u32 instance; f32 x y z radius)[drops]   (world space; radius 0..50 mm;
///                                                       instance 0xffffffff: none)
/// ```
///
/// Trailing bytes are ignored (a newer writer's).
pub fn decode_falling(p: &[u8]) -> Result<Vec<FallingDrop>, &'static str> {
    let word = |at: usize| -> Result<u32, &'static str> {
        p.get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .ok_or("the section is cut short")
    };
    let n = word(0)? as usize;
    if n > MAX_FALLING_DROPS {
        return Err("too many drops in the air");
    }
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let at = WETF_HEADER + WETF_DROP_BYTES * k;
        let f = |o: usize| word(at + o).map(f32::from_bits);
        let d = FallingDrop {
            instance: word(at)?,
            position: Vec3::new(f(4)?, f(8)?, f(12)?),
            radius: f(16)?,
        };
        if !d.position.is_finite() || !(d.radius > 0.0 && d.radius <= 50.0) {
            return Err("a drop in the air is out of its range");
        }
        out.push(d);
    }
    Ok(out)
}

/// S3d: the `WETF` payload of `drops`.
pub fn encode_falling(drops: &[FallingDrop]) -> Vec<u8> {
    let mut out = Vec::with_capacity(WETF_HEADER + WETF_DROP_BYTES * drops.len());
    out.extend_from_slice(&(drops.len() as u32).to_le_bytes());
    for d in drops {
        out.extend_from_slice(&d.instance.to_le_bytes());
        for v in [d.position.x, d.position.y, d.position.z, d.radius] {
            out.extend_from_slice(&v.to_bits().to_le_bytes());
        }
    }
    out
}

/// S3d: checks the drops in the air against the scene's instances: each names one of them (or
/// [`NO_INSTANCE`]), a finite point, a radius in 0..50 mm, at most [`MAX_FALLING_DROPS`].
pub fn check_falling(drops: &[FallingDrop], instances: usize) -> Result<(), &'static str> {
    if drops.len() > MAX_FALLING_DROPS {
        return Err("too many drops in the air");
    }
    for d in drops {
        if (d.instance != NO_INSTANCE && d.instance as usize >= instances)
            || !d.position.is_finite()
            || !(d.radius > 0.0 && d.radius <= 50.0)
        {
            return Err("a drop in the air is out of its range");
        }
    }
    Ok(())
}

/// What lies on a point of a surface: how wet it is, the share under dust and the share snow covers,
/// each 0..1.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Layers {
    /// Wet, 0..1.
    pub wet: f32,
    /// Under dust, 0..1.
    pub dust: f32,
    /// Covered by snow, 0..1 (from its depth).
    pub snow: f32,
}

impl Layers {
    /// Nothing on it.
    pub fn is_clear(&self) -> bool {
        self.wet <= 0.0 && self.dust <= 0.0 && self.snow <= 0.0
    }
}

/// The weather of one instance, the payload of a `WETP` section:
///
/// ```text
/// off  type  field
///   0  u32   instance        its index among the INST sections
///   4  u32   triangles       of the instance's mesh (they must agree)
///   8  u32   samples         the sum of (R + 1)(R + 2)/2 over the triangles
///  12  u32   drops
///  16  f32   cap_angle_deg   of its drops, 1..179
///  20  f32   porosity        how much a wet film darkens it, 0..1
///  24  u8    resolution[triangles] (1..255), zero padding to 4
///      u8    (wet dust snow)[samples], zero padding to 4
///      (u32 triangle; f32 x y z radius)[drops]   (object space; radius 0..50 mm)
/// ```
#[derive(Clone, Debug, PartialEq)]
pub struct PartWeather {
    /// Its index among the instances.
    pub instance: u32,
    /// The resolution of each triangle (S3e: up to [`MAX_FINE_RESOLUTION`] in a `WTP2` section).
    pub resolution: Vec<u16>,
    /// Wet, dust and snow of each sample.
    pub values: Vec<[u8; 3]>,
    /// The contact angle its drops are capped at, degrees.
    pub cap_angle_deg: f32,
    /// How much its material darkens when wet, 0..1.
    pub porosity: f32,
    /// Its drops.
    pub drops: Vec<WetDrop>,
    /// S3f: the shape of each of its drops (the shape tail), or none: round caps.
    pub shapes: Vec<DropShape>,
    /// S3e: the dust's grains drawn over its layer (the motes tail), or none.
    pub motes: Option<MoteSpec>,
    /// The first sample of each triangle.
    first: Vec<u32>,
}

/// S3e: the grains of the dust on an instance, the payload of the motes tail ([`MOTE_TAG`], then
/// `f32 size_mm size_var; u32 seed`): grains of the dust effect's size, where a sample's share under
/// dust passes [`MOTE_THRESHOLD`], [`MOTE_SHARE`] of the grains its share stands for, each placed by
/// a hash of the seed, the triangle, the sample and its number ([`motes_on`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MoteSpec {
    /// Mean diameter of a grain, mm (0..50).
    pub size_mm: f32,
    /// Its relative variation, 0..1.
    pub size_var: f32,
    /// The seed of their places.
    pub seed: u32,
}

/// Bytes `n` rounded up to a multiple of 4.
fn padded(n: usize) -> usize {
    n.div_ceil(4) * 4
}

impl PartWeather {
    /// The weather of `instance`: its triangles' resolutions, their samples, its drops. Fails when
    /// the samples are not the resolutions', a resolution is out of 1..255, a value is not finite or
    /// out of its range.
    pub fn new(
        instance: u32,
        resolution: Vec<u16>,
        values: Vec<[u8; 3]>,
        cap_angle_deg: f32,
        porosity: f32,
        drops: Vec<WetDrop>,
    ) -> Result<PartWeather, &'static str> {
        let mut first = Vec::with_capacity(resolution.len());
        let mut total = 0u64;
        for &r in &resolution {
            if r == 0 || u32::from(r) > MAX_FINE_RESOLUTION {
                return Err("a triangle's resolution is out of 1..4095");
            }
            first.push(total as u32);
            total += u64::from(samples_of(u32::from(r)));
        }
        if total != values.len() as u64 {
            return Err("the samples are not those of the triangles' resolutions");
        }
        if !(1.0..=179.0).contains(&cap_angle_deg) || !(0.0..=1.0).contains(&porosity) {
            return Err("the cap angle or the porosity is out of its range");
        }
        if drops.len() > MAX_WET_DROPS {
            return Err("too many drops");
        }
        for d in &drops {
            if d.triangle as usize >= resolution.len()
                || !d.position.is_finite()
                || !(d.radius > 0.0 && d.radius <= 50.0)
            {
                return Err("a drop is out of its range");
            }
        }
        Ok(PartWeather {
            instance,
            resolution,
            values,
            cap_angle_deg,
            porosity,
            drops,
            shapes: Vec::new(),
            motes: None,
            first,
        })
    }

    /// S3e: true when a triangle's resolution needs two bytes (a `WTP2` section).
    pub fn wide(&self) -> bool {
        self.resolution
            .iter()
            .any(|&r| u32::from(r) > MAX_RESOLUTION)
    }

    /// S3e: the same weather with the grains of its dust. Fails when the size or its variation is
    /// out of range.
    pub fn with_motes(mut self, motes: MoteSpec) -> Result<PartWeather, &'static str> {
        if !(motes.size_mm > 0.0 && motes.size_mm <= 50.0) || !(0.0..=1.0).contains(&motes.size_var)
        {
            return Err("the motes are out of their range");
        }
        self.motes = Some(motes);
        Ok(self)
    }

    /// S3f: the same weather with the shapes of its drops (one each, in their order). Fails when
    /// they are not one per drop or one is out of its range.
    pub fn with_shapes(mut self, shapes: Vec<DropShape>) -> Result<PartWeather, &'static str> {
        if !shapes.is_empty() && shapes.len() != self.drops.len() {
            return Err("the shapes are not one per drop");
        }
        if !shapes.iter().all(DropShape::is_valid) {
            return Err("a drop's shape is out of its range");
        }
        self.shapes = shapes;
        Ok(self)
    }

    /// Reads a `WETP` payload (see the layout above). S3f: after the drops, a shape tail (the tag
    /// [`SHAPE_TAG`], `u32 count` equal to the drops, `f32 shape[15][count]`: [`DropShape`]); a tail
    /// with that tag that does not fit makes the section invalid. S3e: then a motes tail
    /// ([`MOTE_TAG`], [`MoteSpec`]). Other trailing bytes are ignored (a newer writer's).
    pub fn decode(p: &[u8]) -> Result<PartWeather, &'static str> {
        PartWeather::decode_as(p, false)
    }

    /// S3e: reads a `WTP2` payload: a `WETP` whose resolutions are two bytes each
    /// (`u16 resolution[triangles]`, zero padding to 4).
    pub fn decode_wide(p: &[u8]) -> Result<PartWeather, &'static str> {
        PartWeather::decode_as(p, true)
    }

    fn decode_as(p: &[u8], wide: bool) -> Result<PartWeather, &'static str> {
        let word = |at: usize| -> Result<u32, &'static str> {
            p.get(at..at + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .ok_or("the section is cut short")
        };
        let float = |at: usize| -> Result<f32, &'static str> {
            let v = f32::from_bits(word(at)?);
            if v.is_finite() {
                Ok(v)
            } else {
                Err("a value is not finite")
            }
        };
        let instance = word(0)?;
        let triangles = word(4)? as usize;
        let samples = word(8)? as usize;
        let drops = word(12)? as usize;
        let cap_angle_deg = float(16)?;
        let porosity = float(20)?;
        let res_bytes = if wide {
            triangles.checked_mul(2).ok_or("the section is cut short")?
        } else {
            triangles
        };
        let res_end = WETP_HEADER
            .checked_add(padded(res_bytes))
            .ok_or("the section is cut short")?;
        let val_end = res_end
            .checked_add(padded(
                samples.checked_mul(3).ok_or("the section is cut short")?,
            ))
            .ok_or("the section is cut short")?;
        let end = val_end
            .checked_add(drops.checked_mul(20).ok_or("the section is cut short")?)
            .ok_or("the section is cut short")?;
        if p.len() < end {
            return Err("the section is cut short");
        }
        let resolution: Vec<u16> = if wide {
            p[WETP_HEADER..WETP_HEADER + res_bytes]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect()
        } else {
            p[WETP_HEADER..WETP_HEADER + triangles]
                .iter()
                .map(|&r| u16::from(r))
                .collect()
        };
        let values = p[res_end..res_end + 3 * samples]
            .chunks_exact(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect();
        let mut list = Vec::with_capacity(drops);
        for k in 0..drops {
            let at = val_end + 20 * k;
            list.push(WetDrop {
                triangle: word(at)?,
                position: Vec3::new(float(at + 4)?, float(at + 8)?, float(at + 12)?),
                radius: float(at + 16)?,
            });
        }
        let mut weather =
            PartWeather::new(instance, resolution, values, cap_angle_deg, porosity, list)?;
        let mut end = end;
        // S3f: the shape tail.
        if p.len() >= end + 8 && p[end..end + 4] == SHAPE_TAG {
            let count = word(end + 4)? as usize;
            if count != drops {
                return Err("the shapes are not one per drop");
            }
            let mut shapes = Vec::with_capacity(count);
            for k in 0..count {
                let at = end + 8 + 4 * SHAPE_FLOATS * k;
                let mut f = [0.0f32; SHAPE_FLOATS];
                for (c, v) in f.iter_mut().enumerate() {
                    *v = float(at + 4 * c)?;
                }
                shapes.push(DropShape::from_floats(f));
            }
            weather = weather.with_shapes(shapes)?;
            end += 8 + 4 * SHAPE_FLOATS * count;
        }
        // S3e: the motes tail.
        if p.len() >= end + 4 && p[end..end + 4] == MOTE_TAG {
            let motes = MoteSpec {
                size_mm: float(end + 4)?,
                size_var: float(end + 8)?,
                seed: word(end + 12)?,
            };
            weather = weather.with_motes(motes)?;
        }
        Ok(weather)
    }

    /// The `WETP` payload.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for w in [
            self.instance,
            self.resolution.len() as u32,
            self.values.len() as u32,
            self.drops.len() as u32,
            self.cap_angle_deg.to_bits(),
            self.porosity.to_bits(),
        ] {
            out.extend_from_slice(&w.to_le_bytes());
        }
        // S3e: two bytes each when one needs it (a `WTP2` section: [`PartWeather::wide`]).
        if self.wide() {
            for r in &self.resolution {
                out.extend_from_slice(&r.to_le_bytes());
            }
            out.resize(WETP_HEADER + padded(2 * self.resolution.len()), 0);
        } else {
            out.extend(self.resolution.iter().map(|&r| r as u8));
            out.resize(WETP_HEADER + padded(self.resolution.len()), 0);
        }
        for v in &self.values {
            out.extend_from_slice(v);
        }
        let len = out.len();
        out.resize(
            len + padded(3 * self.values.len()) - 3 * self.values.len(),
            0,
        );
        for d in &self.drops {
            out.extend_from_slice(&d.triangle.to_le_bytes());
            for v in [d.position.x, d.position.y, d.position.z, d.radius] {
                out.extend_from_slice(&v.to_bits().to_le_bytes());
            }
        }
        // S3f: the shape tail.
        if !self.shapes.is_empty() {
            out.extend_from_slice(&SHAPE_TAG);
            out.extend_from_slice(&(self.shapes.len() as u32).to_le_bytes());
            for s in &self.shapes {
                for v in s.to_floats() {
                    out.extend_from_slice(&v.to_bits().to_le_bytes());
                }
            }
        }
        // S3e: the motes tail.
        if let Some(m) = &self.motes {
            out.extend_from_slice(&MOTE_TAG);
            for w in [m.size_mm.to_bits(), m.size_var.to_bits(), m.seed] {
                out.extend_from_slice(&w.to_le_bytes());
            }
        }
        out
    }

    /// Triangles of its mesh.
    pub fn triangles(&self) -> usize {
        self.resolution.len()
    }

    /// True when nothing lies on it: no sample holds anything and there is no drop.
    pub fn is_clear(&self) -> bool {
        self.drops.is_empty() && self.values.iter().all(|v| *v == [0, 0, 0])
    }

    /// The layers at barycentric weights `bary` of triangle `triangle`: the samples of the small
    /// triangle of its grid the point falls in, blended linearly. `None` past its triangles.
    pub fn at(&self, triangle: u32, bary: [f32; 3]) -> Option<Layers> {
        let t = triangle as usize;
        let r = u32::from(*self.resolution.get(t)?);
        let first = self.first[t];
        let rf = r as f32;
        let x = (bary[1] * rf).clamp(0.0, rf);
        let y = (bary[2] * rf).clamp(0.0, rf);
        let mut i = (x.floor() as u32).min(r);
        let mut j = (y.floor() as u32).min(r);
        // On the far edge (x + y = R): the cell below it.
        while i + j + 1 > r {
            if i > 0 {
                i -= 1;
            } else {
                j -= 1;
            }
        }
        let (fx, fy) = (x - i as f32, y - j as f32);
        let get = |a: u32, b: u32| -> [f32; 3] {
            let v = self.values[(first + sample_index(r, a, b)) as usize];
            [f32::from(v[0]), f32::from(v[1]), f32::from(v[2])]
        };
        let mix = |p: [f32; 3], q: [f32; 3], s: [f32; 3], w: [f32; 3]| -> [f32; 3] {
            [
                p[0] * w[0] + q[0] * w[1] + s[0] * w[2],
                p[1] * w[0] + q[1] * w[1] + s[1] * w[2],
                p[2] * w[0] + q[2] * w[1] + s[2] * w[2],
            ]
        };
        let v = if fx + fy > 1.0 && i + j + 2 <= r {
            mix(
                get(i + 1, j + 1),
                get(i, j + 1),
                get(i + 1, j),
                [fx + fy - 1.0, 1.0 - fx, 1.0 - fy],
            )
        } else {
            let w0 = (1.0 - fx - fy).max(0.0);
            let sum = w0 + fx + fy;
            mix(
                get(i, j),
                get(i + 1, j),
                get(i, j + 1),
                [w0 / sum, fx / sum, fy / sum],
            )
        };
        Some(layers_of(v))
    }
}

/// The layers of a point whose bytes (wet, dust, snow) blend to `v`.
fn layers_of(v: [f32; 3]) -> Layers {
    let depth = v[2] * SNOW_STEP_MM;
    Layers {
        wet: v[0] * (1.0 / 255.0),
        dust: v[1] * (1.0 / 255.0),
        snow: if depth > 0.0 {
            1.0 - fmath::exp(-depth / SNOW_COVER_MM)
        } else {
            0.0
        },
    }
}

/// S3e: the rain, dust and snow on the studio floor (the plane `z` of `FLOR`, which is not a mesh),
/// the payload of the `WETG` section (at most one):
///
/// ```text
/// off  type  field
///   0  u32   nx ny           cells along X and Y (at most MAX_FLOOR_CELLS)
///   8  f32   x0 y0           the corner of the cells with the lower X and Y, world, mm
///  16  f32   cell            the side of a cell, mm
///  20  f32   z               the height of the plane
///  24  f32   porosity        how much a wet film darkens the floor, 0..1
///  28  u32   flags           0
///  32  u8    (wet dust snow)[nx × ny]   (row j after row j − 1), zero padding to 4
/// ```
///
/// A point over the cells reads them linearly between the cells' centres (as a hit reads a part's
/// samples); past them nothing lies on the floor. Trailing bytes are ignored (a newer writer's).
#[derive(Clone, Debug, PartialEq)]
pub struct FloorWeather {
    /// Cells along X and Y.
    pub nx: u32,
    /// See [`FloorWeather::nx`].
    pub ny: u32,
    /// The corner of the cells with the lower X and Y, world, mm.
    pub x0: f32,
    /// See [`FloorWeather::x0`].
    pub y0: f32,
    /// The side of a cell, mm.
    pub cell: f32,
    /// The height of the plane, mm.
    pub z: f32,
    /// How much a wet film darkens the floor, 0..1.
    pub porosity: f32,
    /// Wet, dust and snow of each cell.
    pub values: Vec<[u8; 3]>,
}

impl FloorWeather {
    /// Checks its numbers: the cells fit and are finite, the porosity in 0..1.
    pub fn check(&self) -> Result<(), &'static str> {
        let cells = u64::from(self.nx) * u64::from(self.ny);
        if self.nx == 0 || self.ny == 0 || cells > u64::from(MAX_FLOOR_CELLS) {
            return Err("the floor's cells are out of their range");
        }
        if cells != self.values.len() as u64 {
            return Err("the floor's values are not one per cell");
        }
        if !(self.x0.is_finite() && self.y0.is_finite() && self.z.is_finite())
            || !(self.cell > 0.0 && self.cell <= 1000.0)
            || !(0.0..=1.0).contains(&self.porosity)
        {
            return Err("the floor's numbers are out of their range");
        }
        Ok(())
    }

    /// Reads a `WETG` payload.
    pub fn decode(p: &[u8]) -> Result<FloorWeather, &'static str> {
        let word = |at: usize| -> Result<u32, &'static str> {
            p.get(at..at + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .ok_or("the section is cut short")
        };
        let float = |at: usize| word(at).map(f32::from_bits);
        let (nx, ny) = (word(0)?, word(4)?);
        let cells = u64::from(nx) * u64::from(ny);
        if cells > u64::from(MAX_FLOOR_CELLS) {
            return Err("the floor's cells are out of their range");
        }
        let n = cells as usize;
        if p.len() < WETG_HEADER + 3 * n {
            return Err("the section is cut short");
        }
        let f = FloorWeather {
            nx,
            ny,
            x0: float(8)?,
            y0: float(12)?,
            cell: float(16)?,
            z: float(20)?,
            porosity: float(24)?,
            values: p[WETG_HEADER..WETG_HEADER + 3 * n]
                .chunks_exact(3)
                .map(|c| [c[0], c[1], c[2]])
                .collect(),
        };
        f.check()?;
        Ok(f)
    }

    /// The `WETG` payload.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(WETG_HEADER + padded(3 * self.values.len()));
        for w in [
            self.nx,
            self.ny,
            self.x0.to_bits(),
            self.y0.to_bits(),
            self.cell.to_bits(),
            self.z.to_bits(),
            self.porosity.to_bits(),
            0,
        ] {
            out.extend_from_slice(&w.to_le_bytes());
        }
        for v in &self.values {
            out.extend_from_slice(v);
        }
        out.resize(WETG_HEADER + padded(3 * self.values.len()), 0);
        out
    }

    /// True when nothing lies on it.
    pub fn is_clear(&self) -> bool {
        self.values.iter().all(|v| *v == [0, 0, 0])
    }

    /// The layers at `(x, y)` of the plane: the four cells around it blended linearly between their
    /// centres; `None` past its cells.
    pub fn at(&self, x: f32, y: f32) -> Option<Layers> {
        let (w, h) = (self.nx as f32 * self.cell, self.ny as f32 * self.cell);
        let (dx, dy) = (x - self.x0, y - self.y0);
        if !(dx >= 0.0 && dy >= 0.0 && dx <= w && dy <= h) {
            return None;
        }
        let axis = |d: f32, n: u32| {
            let f = (d / self.cell - 0.5).clamp(0.0, (n - 1) as f32);
            let i = (f.floor() as u32).min(n - 1);
            (i, (i + 1).min(n - 1), f - i as f32)
        };
        let (i0, i1, tx) = axis(dx, self.nx);
        let (j0, j1, ty) = axis(dy, self.ny);
        let get = |i: u32, j: u32| -> [f32; 3] {
            let v = self.values[(j * self.nx + i) as usize];
            [f32::from(v[0]), f32::from(v[1]), f32::from(v[2])]
        };
        let (a, b, c, d) = (get(i0, j0), get(i1, j0), get(i0, j1), get(i1, j1));
        let mut v = [0.0f32; 3];
        for k in 0..3 {
            let lo = a[k] + (b[k] - a[k]) * tx;
            let hi = c[k] + (d[k] - c[k]) * tx;
            v[k] = lo + (hi - lo) * ty;
        }
        Some(layers_of(v))
    }
}

/// S3e: a 32-bit hash (Wellons' `lowbias32`): the motes' places, which the page's Fast preview
/// draws with its twin.
pub fn hash32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

/// S3e: the uniform number in `[0, 1)` of a hash (its top 24 bits).
pub fn unit32(h: u32) -> f32 {
    (h >> 8) as f32 * (1.0 / 16_777_216.0)
}

/// S3e: a grain of dust on an instance: on its mesh's triangle `triangle`, centred at `position`
/// on the surface (object space), the face's unit normal there, its radius.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mote {
    /// Its triangle in the mesh.
    pub triangle: u32,
    /// Its foot on the surface, object space.
    pub position: Vec3,
    /// The outward unit normal of its triangle, object space.
    pub normal: Vec3,
    /// Its radius, mm.
    pub radius: f32,
}

/// S3e: the grains of dust of `w` (its motes tail) on the triangles `corners` gives (object space,
/// the outward way), sample by sample in their order, at most `budget`: where a sample's share
/// under dust `c` passes [`MOTE_THRESHOLD`], [`MOTE_SHARE`] of the `−ln(1 − c) / (π r̄²)` grains per
/// unit area its share stands for (the coverage of grains of mean area `π r̄²` dropped at random),
/// over the sample's share of its triangle's area; each placed in the cell around its sample and
/// sized by [`hash32`] of the seed, the triangle, the sample and its number.
pub fn motes_on(
    w: &PartWeather,
    corners: impl Fn(u32) -> Option<[Vec3; 3]>,
    budget: usize,
) -> Vec<Mote> {
    let mut out = Vec::new();
    let Some(spec) = w.motes else {
        return out;
    };
    let r_mean = 0.5 * spec.size_mm;
    let var = spec.size_var.clamp(0.0, 1.0);
    let grain = fmath::PI * r_mean * r_mean * (1.0 + var * var / 3.0);
    if grain <= 0.0 || grain.is_nan() {
        return out;
    }
    for (t, &res) in w.resolution.iter().enumerate() {
        let r = u32::from(res);
        let first = w.first[t];
        let n = samples_of(r);
        if !(0..n).any(|k| f32::from(w.values[(first + k) as usize][1]) >= MOTE_THRESHOLD * 255.0) {
            continue;
        }
        let Some([a, b, c]) = corners(t as u32) else {
            continue;
        };
        let cross = (b - a).cross(c - a);
        let len = cross.length();
        if !(len > 0.0 && len.is_finite()) {
            continue;
        }
        let normal = cross / len;
        let area = 0.5 * len / n as f32;
        let rf = r as f32;
        for j in 0..=r {
            for i in 0..=r - j {
                let k = sample_index(r, i, j);
                let share = f32::from(w.values[(first + k) as usize][1]) * (1.0 / 255.0);
                if share < MOTE_THRESHOLD {
                    continue;
                }
                let mean = MOTE_SHARE * -fmath::ln(1.0 - share.min(0.999)) * area / grain;
                let key = hash32(spec.seed ^ hash32(t as u32 ^ hash32(k)));
                let count = (mean + unit32(hash32(key ^ 0x6d6f_7465))).floor() as u32;
                for m in 0..count {
                    if out.len() >= budget {
                        return out;
                    }
                    let h = hash32(key ^ hash32(m.wrapping_add(1)));
                    let h2 = hash32(h);
                    let h3 = hash32(h2);
                    let mut u = (i as f32 + unit32(h) - 0.5).max(0.0) / rf;
                    let mut v = (j as f32 + unit32(h2) - 0.5).max(0.0) / rf;
                    if u + v > 1.0 {
                        let s = u + v;
                        u /= s;
                        v /= s;
                    }
                    let radius = (r_mean * (1.0 + var * (2.0 * unit32(h3) - 1.0))).max(0.01);
                    out.push(Mote {
                        triangle: t as u32,
                        position: a + (b - a) * u + (c - a) * v,
                        normal,
                        radius,
                    });
                }
            }
        }
    }
    out
}

/// S3e: the material of the motes: dry dust.
pub fn dust() -> Material {
    Material {
        base_color: DUST_ALBEDO,
        roughness: DUST_ROUGHNESS,
        ..Material::default()
    }
}

/// S3e: the motes of `parts` in world space, each with the instance it lies on: its centre a third
/// of its radius above its foot, along its face's outward normal, carried by its instance's
/// transform; at most [`MAX_MOTES`] in all.
pub fn motes_of(
    parts: &[PartWeather],
    instances: &[crate::geometry::Instance],
    meshes: &[Mesh],
) -> Vec<(u32, Vec3, Vec3, f32)> {
    let mut out = Vec::new();
    for p in parts {
        if p.motes.is_none() {
            continue;
        }
        let Some(inst) = instances.get(p.instance as usize) else {
            continue;
        };
        let (Some(mesh), Some(inverse)) =
            (meshes.get(inst.mesh as usize), inst.transform.inverse())
        else {
            continue;
        };
        let flip = mesh.inside_out();
        let left = MAX_MOTES.saturating_sub(out.len());
        let corners = |t: u32| {
            mesh.triangle(t as usize)
                .map(|[a, b, c]| if flip { [a, c, b] } else { [a, b, c] })
        };
        for m in motes_on(p, corners, left) {
            let normal = inverse.transpose_vector(m.normal).normalize();
            if normal.length_squared().is_nan() || normal.length_squared() <= 0.5 {
                continue;
            }
            let foot = inst.transform.point(m.position);
            out.push((
                p.instance,
                foot + normal * (m.radius / 3.0),
                normal,
                m.radius,
            ));
        }
    }
    out
}

/// S3e: the mesh of the motes (centre, unit normal, radius each; world space): an octahedron each,
/// its axes the normal and two tangents, the normals of a sphere; [`MOTE_TRIANGLES`] triangles each.
/// `None` without any.
pub fn mote_mesh(motes: &[(Vec3, Vec3, f32)]) -> Option<Mesh> {
    if motes.is_empty() {
        return None;
    }
    let mut positions = Vec::with_capacity(6 * motes.len());
    let mut normals = Vec::with_capacity(6 * motes.len());
    let mut indices = Vec::with_capacity(24 * motes.len());
    for &(c, n, r) in motes {
        let helper = if n.z.abs() < 0.9 {
            Vec3::new(0.0, 0.0, 1.0)
        } else {
            Vec3::new(1.0, 0.0, 0.0)
        };
        let u = helper.cross(n).normalize();
        let v = n.cross(u);
        let base = positions.len() as u32;
        // 0 +n, 1 +u, 2 +v, 3 −u, 4 −v, 5 −n.
        for d in [n, u, v, -u, -v, -n] {
            positions.push(c + d * r);
            normals.push(d);
        }
        for t in [
            [0, 1, 2],
            [0, 2, 3],
            [0, 3, 4],
            [0, 4, 1],
            [5, 2, 1],
            [5, 3, 2],
            [5, 4, 3],
            [5, 1, 4],
        ] {
            indices.extend(t.iter().map(|k| base + k));
        }
    }
    Mesh::new(&positions, &normals, &indices, 0).ok()
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// `m` under the layers `l` of a surface whose wet film darkens it by `porosity` (see the
/// [module](self) documentation); `None` when nothing lies there or `m` is an emitter (it is shaded
/// as it is).
pub fn weathered(m: &Material, l: Layers, porosity: f32) -> Option<Material> {
    if l.is_clear() || m.kind == MATERIAL_EMISSIVE {
        return None;
    }
    let mut out = m.clone();
    let (wet, dust, snow) = (
        l.wet.clamp(0.0, 1.0),
        l.dust.clamp(0.0, 1.0),
        l.snow.clamp(0.0, 1.0),
    );
    // Dust: a dry grey layer, darker where it is wet (it is porous).
    if dust > 0.0 {
        let soaked = DUST_ALBEDO.map(|c| lerp(c, c * c, wet));
        out.base_color = Rgb::new(
            lerp(out.base_color.r, soaked.r, dust),
            lerp(out.base_color.g, soaked.g, dust),
            lerp(out.base_color.b, soaked.b, dust),
        );
        out.roughness = lerp(out.roughness, DUST_ROUGHNESS, dust);
        out.metallic *= 1.0 - dust;
        out.transmission *= 1.0 - dust;
        out.coat *= 1.0 - dust;
        out.anisotropy *= 1.0 - dust;
    }
    // The film of water: a smooth clear coat, and a porous albedo darker.
    if wet > 0.0 {
        let k = 1.0 + wet * porosity.clamp(0.0, 1.0) * WET_DARKEN;
        if k > 1.0 && out.metallic < 1.0 {
            let dark = out.base_color.map(|c| fmath::powf(c.clamp(0.0, 1.0), k));
            let m = out.metallic.clamp(0.0, 1.0);
            out.base_color = Rgb::new(
                lerp(dark.r, out.base_color.r, m),
                lerp(dark.g, out.base_color.g, m),
                lerp(dark.b, out.base_color.b, m),
            );
        }
        let coat = out.coat.max(wet);
        out.coat_roughness = if out.coat > 0.0 {
            out.coat_roughness
                .min(lerp(out.coat_roughness, WET_COAT_ROUGHNESS, wet))
        } else {
            WET_COAT_ROUGHNESS
        };
        out.coat = coat;
    }
    // Snow: white, rough, diffuse.
    if snow > 0.0 {
        out.base_color = out.base_color.map(|c| lerp(c, SNOW_ALBEDO, snow));
        out.roughness = lerp(out.roughness, SNOW_ROUGHNESS, snow);
        out.metallic *= 1.0 - snow;
        out.transmission *= 1.0 - snow;
        out.coat *= 1.0 - snow;
        out.anisotropy *= 1.0 - snow;
        if out.kind == MATERIAL_GLASS && out.transmission <= 0.0 {
            out.kind = crate::scene::MATERIAL_PRINCIPLED;
        }
    }
    Some(out)
}

/// The material of the drops: clear, smooth water.
pub fn water() -> Material {
    Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness: 0.0,
        ior: WATER_IOR,
        transmission: 1.0,
        ..Material::default()
    }
}

/// One drop's cap in world space: its centre on the surface, the surface's outward normal there
/// (unit), its contact radius and its contact angle.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cap {
    /// Centre of the contact circle.
    pub centre: Vec3,
    /// Unit normal of the surface there.
    pub normal: Vec3,
    /// Contact radius, mm.
    pub radius: f32,
    /// Contact angle, degrees.
    pub angle_deg: f32,
    /// S3f: its shape (axes in world space), or none: round.
    pub shape: Option<DropShape>,
}

/// The mesh of the caps (world space, the sphere's normals), `None` without any.
pub fn cap_mesh(caps: &[Cap]) -> Option<Mesh> {
    water_mesh(caps, &[])
}

/// S3f: the triangles of each cap in the mesh of `caps`: [`SHAPED_CAP_TRIANGLES`] when one of them
/// has a shape, else [`CAP_TRIANGLES`].
pub fn cap_triangles(caps: &[Cap]) -> u32 {
    if caps.iter().any(|c| c.shape.is_some()) {
        SHAPED_CAP_TRIANGLES
    } else {
        CAP_TRIANGLES
    }
}

/// S3d: the mesh of the caps and, after them, of the drops in the air (spheres: centre and
/// radius), world space: [`cap_triangles`] triangles each cap, then [`SPHERE_TRIANGLES`] each
/// sphere; `None` without any. S3f: when a cap has a shape every cap is meshed with
/// [`SHAPED_CAP_RINGS`] rings, and a deformed one ([`shape_point`]) takes the normals of its faces.
pub fn water_mesh(caps: &[Cap], spheres: &[(Vec3, f32)]) -> Option<Mesh> {
    if caps.is_empty() && spheres.is_empty() {
        return None;
    }
    let shaped = caps.iter().any(|c| c.shape.is_some());
    let (segments, rings) = if shaped {
        (SHAPED_CAP_SEGMENTS, SHAPED_CAP_RINGS)
    } else {
        (CAP_SEGMENTS, CAP_RINGS)
    };
    let per = 1 + rings * segments;
    let per_sphere = 2 + (SPHERE_RINGS - 1) * SPHERE_SEGMENTS;
    let vertices = caps.len() * per as usize + spheres.len() * per_sphere as usize;
    let mut positions = Vec::with_capacity(vertices);
    let mut normals = Vec::with_capacity(vertices);
    let mut indices = Vec::new();
    let ring = |base: u32, r: u32, s: u32| base + 1 + (r - 1) * segments + s % segments;
    for c in caps {
        let n = c.normal;
        let helper = if n.z.abs() < 0.9 {
            Vec3::new(0.0, 0.0, 1.0)
        } else {
            Vec3::new(1.0, 0.0, 0.0)
        };
        let u = helper.cross(n).normalize();
        let v = n.cross(u);
        let theta = c.angle_deg.clamp(1.0, 179.0) * fmath::DEG_TO_RAD;
        let (st, ct) = fmath::sin_cos(theta);
        let big = c.radius / st;
        // The sphere's centre (below the plane for θ < 90°), lifted a hair off the surface.
        let lift = 1.0e-3 * c.radius;
        let centre = c.centre - n * (big * ct) + n * lift;
        let base = positions.len() as u32;
        let first_index = indices.len();
        positions.push(centre + n * big);
        normals.push(n);
        for r in 1..=rings {
            let phi = theta * r as f32 / rings as f32;
            let (sp, cp) = fmath::sin_cos(phi);
            for s in 0..segments {
                let psi = std::f32::consts::TAU * s as f32 / segments as f32;
                let (ss, cs) = fmath::sin_cos(psi);
                let dir = (u * cs + v * ss) * sp + n * cp;
                positions.push(centre + dir * big);
                normals.push(dir);
            }
        }
        for s in 0..segments {
            indices.extend_from_slice(&[base, ring(base, 1, s), ring(base, 1, s + 1)]);
        }
        for r in 1..rings {
            for s in 0..segments {
                let (a, b) = (ring(base, r, s), ring(base, r, s + 1));
                let (c2, d) = (ring(base, r + 1, s), ring(base, r + 1, s + 1));
                indices.extend_from_slice(&[a, c2, d, a, d, b]);
            }
        }
        // S3f: the deformed cap, with the normals of its faces (turned the way the sphere's were).
        if let Some(shape) = c.shape.filter(|s| !s.is_round()) {
            let frame = ShapeFrame::new(n, &shape, c.radius, c.angle_deg);
            let first = base as usize;
            for p in positions[first..].iter_mut() {
                *p = c.centre + shape_point(*p - c.centre, &frame, &shape);
            }
            let mut sum = vec![Vec3::ZERO; positions.len() - first];
            for t in indices[first_index..].chunks_exact(3) {
                let (i, j, k) = (t[0] as usize, t[1] as usize, t[2] as usize);
                let face = (positions[j] - positions[i]).cross(positions[k] - positions[i]);
                for x in [i, j, k] {
                    sum[x - first] += face;
                }
            }
            for (k, s) in sum.iter().enumerate() {
                let m = s.normalize();
                if m.length_squared() > 0.5 {
                    let was = normals[first + k];
                    normals[first + k] = if m.dot(was) < 0.0 { -m } else { m };
                }
            }
        }
    }
    // S3d: the spheres, a pole at +Z, rings of latitude, a pole at −Z (wound outwards).
    let band =
        |base: u32, r: u32, s: u32| base + 1 + (r - 1) * SPHERE_SEGMENTS + s % SPHERE_SEGMENTS;
    for &(centre, radius) in spheres {
        let base = positions.len() as u32;
        let up = Vec3::new(0.0, 0.0, 1.0);
        positions.push(centre + up * radius);
        normals.push(up);
        for r in 1..SPHERE_RINGS {
            let phi = std::f32::consts::PI * r as f32 / SPHERE_RINGS as f32;
            let (sp, cp) = fmath::sin_cos(phi);
            for s in 0..SPHERE_SEGMENTS {
                let psi = std::f32::consts::TAU * s as f32 / SPHERE_SEGMENTS as f32;
                let (ss, cs) = fmath::sin_cos(psi);
                let dir = Vec3::new(sp * cs, sp * ss, cp);
                positions.push(centre + dir * radius);
                normals.push(dir);
            }
        }
        let bottom = positions.len() as u32;
        positions.push(centre - up * radius);
        normals.push(-up);
        for s in 0..SPHERE_SEGMENTS {
            indices.extend_from_slice(&[base, band(base, 1, s), band(base, 1, s + 1)]);
        }
        for r in 1..SPHERE_RINGS - 1 {
            for s in 0..SPHERE_SEGMENTS {
                let (a, b) = (band(base, r, s), band(base, r, s + 1));
                let (c2, d) = (band(base, r + 1, s), band(base, r + 1, s + 1));
                indices.extend_from_slice(&[a, c2, d, a, d, b]);
            }
        }
        let last = SPHERE_RINGS - 1;
        for s in 0..SPHERE_SEGMENTS {
            indices.extend_from_slice(&[bottom, band(base, last, s + 1), band(base, last, s)]);
        }
    }
    Mesh::new(&positions, &normals, &indices, 0).ok()
}

/// Checks the weather of a scene against its instances and meshes: each part names an instance
/// (once), its triangles are its mesh's, and the drops are at most [`MAX_WET_DROPS`].
pub fn check_parts(
    parts: &[PartWeather],
    instances: &[crate::geometry::Instance],
    meshes: &[Mesh],
) -> Result<(), &'static str> {
    let mut seen = vec![false; instances.len()];
    let mut drops = 0usize;
    for p in parts {
        let Some(inst) = instances.get(p.instance as usize) else {
            return Err("instance does not refer to an INST section");
        };
        if std::mem::replace(&mut seen[p.instance as usize], true) {
            return Err("an instance has two WETP sections");
        }
        let triangles = meshes
            .get(inst.mesh as usize)
            .map_or(0, Mesh::triangle_count);
        if triangles != p.triangles() {
            return Err("the triangles are not those of the instance's mesh");
        }
        drops += p.drops.len();
    }
    if drops > MAX_WET_DROPS {
        return Err("too many drops");
    }
    Ok(())
}

/// The caps of the drops of `parts` in world space, each with the instance it lies on: each at
/// its point and along its triangle's outward normal, carried by its instance's transform.
pub fn caps_of(
    parts: &[PartWeather],
    instances: &[crate::geometry::Instance],
    meshes: &[Mesh],
) -> Vec<(u32, Cap)> {
    let mut caps = Vec::new();
    for p in parts {
        let Some(inst) = instances.get(p.instance as usize) else {
            continue;
        };
        let (Some(mesh), Some(inverse)) =
            (meshes.get(inst.mesh as usize), inst.transform.inverse())
        else {
            continue;
        };
        let flip = if mesh.inside_out() { -1.0 } else { 1.0 };
        for (i, d) in p.drops.iter().enumerate() {
            let Some([a, b, c]) = mesh.triangle(d.triangle as usize) else {
                continue;
            };
            let n = (b - a).cross(c - a) * flip;
            let normal = inverse.transpose_vector(n).normalize();
            if normal.length_squared().is_nan() || normal.length_squared() <= 0.5 {
                continue;
            }
            caps.push((
                p.instance,
                Cap {
                    centre: inst.transform.point(d.position),
                    normal,
                    radius: d.radius,
                    angle_deg: p.cap_angle_deg,
                    shape: p
                        .shapes
                        .get(i)
                        .map(|s| s.map_axes(|v| inst.transform.vector(v))),
                },
            ));
        }
    }
    caps
}

/// Which instances have weather, for the integrator.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WeatherSetup {
    /// Per instance, its index among the scene's `wet_parts`.
    by_instance: Vec<Option<u32>>,
    /// The instance of the drops' caps.
    caps: Option<u32>,
    /// S3e: the studio floor has weather.
    floor: bool,
}

impl WeatherSetup {
    /// The weather of `scene`'s instances.
    pub fn new(scene: &Scene) -> WeatherSetup {
        let n = scene.geometry.instances().len();
        let mut by_instance = vec![None; n];
        for (k, w) in scene.wet_parts.iter().enumerate() {
            if let Some(slot) = by_instance.get_mut(w.instance as usize) {
                *slot = Some(k as u32);
            }
        }
        WeatherSetup {
            by_instance,
            caps: scene.caps().map(|c| c.instance),
            floor: scene.wet_floor.as_ref().is_some_and(|f| !f.is_clear()),
        }
    }

    /// True for the instance of the drops' caps.
    pub fn is_caps(&self, instance: u32) -> bool {
        self.caps == Some(instance)
    }

    /// The layers on a hit, and its instance's porosity; `None` where none lies (or no weather).
    pub fn layers(&self, scene: &Scene, hit: &Hit) -> Option<(Layers, f32)> {
        let k = (*self.by_instance.get(hit.instance as usize)?)?;
        let w = &scene.wet_parts[k as usize];
        let l = w.at(hit.triangle, hit.barycentrics)?;
        (!l.is_clear()).then_some((l, w.porosity))
    }

    /// `m` as the weather of `hit` leaves it, `None` where nothing lies there.
    pub fn at(&self, scene: &Scene, hit: &Hit, m: &Material) -> Option<Material> {
        let (l, porosity) = self.layers(scene, hit)?;
        weathered(m, l, porosity)
    }

    /// S3e: the layers on the studio floor at `p` (its plane) and the floor's porosity; `None` where
    /// none lies (or the scene has no floor weather).
    pub fn floor_layers(&self, scene: &Scene, p: Vec3) -> Option<(Layers, f32)> {
        if !self.floor {
            return None;
        }
        let f = scene.wet_floor.as_ref()?;
        let l = f.at(p.x, p.y)?;
        (!l.is_clear()).then_some((l, f.porosity))
    }
}

/// S3e: the material of a visible studio floor of colour `color` under the layers `l` (its film,
/// dust and snow; ◆): a matte diffuse of its colour, weathered as a part's material is.
pub fn floor_material(color: Rgb, l: Layers, porosity: f32) -> Option<Material> {
    let base = Material {
        base_color: color,
        roughness: 1.0,
        ..Material::default()
    };
    weathered(&base, l, porosity)
}

/// S3e: what a shadow-catcher floor shows under the layers `l`, seen at `cos` from its normal (◆):
/// the share `cover` that dust and snow cover, `1 − (1 − dust)(1 − snow)`, is a visible layer (the
/// material [`catcher_cover`]); of the rest, the water film reflects the share `wet × F(cos)`
/// (Schlick's Fresnel of water), a mirror ([`catcher_film`]); the rest is the catcher. Their shares,
/// in that order.
pub fn catcher_shares(l: Layers, cos: f32) -> (f32, f32) {
    let cover = 1.0 - (1.0 - l.dust.clamp(0.0, 1.0)) * (1.0 - l.snow.clamp(0.0, 1.0));
    let c = 1.0 - cos.abs().clamp(0.0, 1.0);
    let fresnel = WATER_F0 + (1.0 - WATER_F0) * c * c * c * c * c;
    let film = (1.0 - cover) * l.wet.clamp(0.0, 1.0) * fresnel;
    (cover, film)
}

/// S3e: the grey a shadow-catcher floor stands for when its film darkens it (◆): what is behind
/// it is darkened as a porous floor of this albedo darkens wet, `CATCHER_GREY^(wet × porosity)`.
pub const CATCHER_GREY: f32 = 0.5;

/// S3e: how much a shadow-catcher floor's water film darkens what is behind it: as the porous
/// darkening of [`weathered`] darkens a floor of [`CATCHER_GREY`] (◆), 1 where it is dry.
pub fn catcher_wet(l: Layers, porosity: f32) -> f32 {
    let w = l.wet.clamp(0.0, 1.0) * porosity.clamp(0.0, 1.0) * WET_DARKEN;
    if w > 0.0 {
        fmath::powf(CATCHER_GREY, w)
    } else {
        1.0
    }
}

/// S3e: the visible layer of a shadow-catcher floor where dust and snow cover it: the dust (wet, as
/// the film makes it) with the snow over it by its share of the cover.
pub fn catcher_cover(l: Layers, porosity: f32) -> Material {
    let cover = 1.0 - (1.0 - l.dust.clamp(0.0, 1.0)) * (1.0 - l.snow.clamp(0.0, 1.0));
    let snow = if cover > 0.0 {
        (l.snow / cover).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let base = dust();
    weathered(
        &base,
        Layers {
            wet: l.wet,
            dust: 1.0,
            snow,
        },
        porosity,
    )
    .unwrap_or(base)
}

/// S3e: the film of water on a shadow-catcher floor: a mirror (its share is the Fresnel of water,
/// [`catcher_shares`]), as smooth as the film on a part ([`WET_COAT_ROUGHNESS`]).
pub fn catcher_film() -> Material {
    Material {
        base_color: Rgb::WHITE,
        metallic: 1.0,
        roughness: WET_COAT_ROUGHNESS,
        ..Material::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weather(res: &[u8], fill: impl Fn(usize) -> [u8; 3]) -> PartWeather {
        let n: u32 = res.iter().map(|&r| samples_of(u32::from(r))).sum();
        PartWeather::new(
            3,
            res.iter().map(|&r| u16::from(r)).collect(),
            (0..n as usize).map(fill).collect(),
            60.0,
            0.5,
            vec![WetDrop {
                triangle: res.len() as u32 - 1,
                position: Vec3::new(1.0, 2.0, 3.0),
                radius: 1.5,
            }],
        )
        .unwrap()
    }

    #[test]
    fn a_section_goes_and_comes_back_and_bad_ones_are_refused() {
        let w = weather(&[2, 3, 1], |k| [k as u8, 2 * k as u8, 3]);
        let bytes = w.encode();
        assert_eq!(bytes.len() % 4, 0);
        assert_eq!(PartWeather::decode(&bytes), Ok(w.clone()));
        assert!(PartWeather::decode(&bytes[..bytes.len() - 1]).is_err());
        let mut bad = bytes.clone();
        bad[24] = 0; // a resolution of 0
        assert!(PartWeather::decode(&bad).is_err());
        let mut bad = bytes.clone();
        bad[8] = 99; // samples that are not the resolutions'
        assert!(PartWeather::decode(&bad).is_err());
        assert!(PartWeather::new(0, vec![1], vec![[0; 3]; 3], 0.5, 0.0, vec![]).is_err());
        let far = WetDrop {
            triangle: 5,
            position: Vec3::ZERO,
            radius: 1.0,
        };
        assert!(PartWeather::new(0, vec![1], vec![[0; 3]; 3], 60.0, 0.0, vec![far]).is_err());
    }

    #[test]
    fn a_hit_blends_the_samples_of_its_cell() {
        // Resolution 2: samples (0,0) (1,0) (2,0) (0,1) (1,1) (0,2), wet = 0, 50, 100, 150, 200, 250.
        let w = weather(&[2], |k| [50 * k as u8, 0, 0]);
        let at = |b1: f32, b2: f32| w.at(0, [1.0 - b1 - b2, b1, b2]).unwrap().wet * 255.0;
        // The corners are the samples.
        assert!((at(0.0, 0.0) - 0.0).abs() < 1e-3);
        assert!((at(1.0, 0.0) - 100.0).abs() < 1e-3);
        assert!((at(0.0, 1.0) - 250.0).abs() < 1e-3);
        assert!((at(0.5, 0.5) - 200.0).abs() < 1e-3);
        // Inside the lower cell (0,0)(1,0)(0,1): linear.
        assert!((at(0.25, 0.0) - 25.0).abs() < 1e-3);
        assert!((at(0.0, 0.25) - 75.0).abs() < 1e-3);
        // Inside the upper cell of the first row: (1,1) (0,1) (1,0).
        assert!((at(0.4, 0.4) - (0.6 * 200.0 + 0.2 * 150.0 + 0.2 * 50.0)).abs() < 1e-2);
        assert!(w.at(5, [1.0, 0.0, 0.0]).is_none());
    }

    #[test]
    fn nothing_on_a_surface_leaves_its_material_as_it_is_and_the_layers_change_it() {
        let m = Material {
            base_color: Rgb::new(0.6, 0.3, 0.1),
            roughness: 0.4,
            ..Material::default()
        };
        assert_eq!(weathered(&m, Layers::default(), 1.0), None);
        let wet = weathered(
            &m,
            Layers {
                wet: 1.0,
                ..Layers::default()
            },
            1.0,
        )
        .unwrap();
        assert_eq!(wet.coat, 1.0);
        assert_eq!(wet.coat_roughness, WET_COAT_ROUGHNESS);
        // Soaked and porous: the albedo squared.
        assert!(
            (wet.base_color.r - 0.36).abs() < 1e-3,
            "{:?}",
            wet.base_color
        );
        // Not porous: only the film.
        let film = weathered(
            &m,
            Layers {
                wet: 1.0,
                ..Layers::default()
            },
            0.0,
        )
        .unwrap();
        assert_eq!(film.base_color, m.base_color);
        let dusty = weathered(
            &m,
            Layers {
                dust: 1.0,
                ..Layers::default()
            },
            0.0,
        )
        .unwrap();
        assert_eq!(dusty.base_color, DUST_ALBEDO);
        assert_eq!(dusty.roughness, DUST_ROUGHNESS);
        let snowy = weathered(
            &m,
            Layers {
                snow: 1.0,
                ..Layers::default()
            },
            0.0,
        )
        .unwrap();
        assert_eq!(snowy.base_color, Rgb::splat(SNOW_ALBEDO));
        // An emitter is shaded as it is.
        let lamp = Material {
            kind: MATERIAL_EMISSIVE,
            ..m
        };
        assert_eq!(
            weathered(
                &lamp,
                Layers {
                    wet: 1.0,
                    ..Layers::default()
                },
                1.0
            ),
            None
        );
    }

    #[test]
    fn a_cap_is_the_part_of_its_sphere_above_the_surface() {
        let c = Cap {
            centre: Vec3::new(10.0, 0.0, 5.0),
            normal: Vec3::new(0.0, 0.0, 1.0),
            radius: 2.0,
            angle_deg: 60.0,
            shape: None,
        };
        let mesh = cap_mesh(&[c]).unwrap();
        assert_eq!(
            mesh.triangle_count() as u32,
            CAP_SEGMENTS * (2 * CAP_RINGS - 1)
        );
        let big = 2.0 / 60f32.to_radians().sin();
        let height = big * (1.0 - 60f32.to_radians().cos());
        let top = mesh.position(0).unwrap();
        assert!((top.z - 5.0 - height).abs() < 1e-2, "{top:?}");
        for i in 1..=CAP_SEGMENTS as usize {
            // The first ring after the top: inside the contact circle, above the surface.
            let p = mesh.position(i).unwrap();
            assert!(p.z > 5.0);
        }
        for i in (1 + (CAP_RINGS - 1) * CAP_SEGMENTS) as usize..mesh.vertex_count() {
            // The last ring is the contact circle.
            let p = mesh.position(i).unwrap();
            let r = ((p.x - 10.0).powi(2) + p.y.powi(2)).sqrt();
            assert!((r - 2.0).abs() < 1e-3 && (p.z - 5.0).abs() < 1e-2, "{p:?}");
        }
        assert!(cap_mesh(&[]).is_none());
    }

    /// A square plate of `half` mm at z = 0 facing up, two triangles.
    fn plate(half: f32) -> Mesh {
        let p = [
            Vec3::new(-half, -half, 0.0),
            Vec3::new(half, -half, 0.0),
            Vec3::new(half, half, 0.0),
            Vec3::new(-half, half, 0.0),
        ];
        Mesh::new(&p, &[], &[0, 1, 2, 0, 2, 3], 0).unwrap()
    }

    #[test]
    fn a_drop_is_meshed_on_its_part_and_lets_the_light_through() {
        use crate::geometry::{Geometry, Instance, Transform};
        use crate::integrator::{BvhTracer, Prepared};
        use crate::math::Ray;
        let mut scene = Scene {
            geometry: Geometry::new(
                vec![plate(50.0)],
                vec![Instance::new(
                    0,
                    Transform {
                        rows: [
                            [1.0, 0.0, 0.0, 0.0],
                            [0.0, 1.0, 0.0, 0.0],
                            [0.0, 0.0, 1.0, 30.0],
                        ],
                    },
                    0,
                )],
            )
            .unwrap(),
            materials: vec![Material::default()],
            ..Scene::default()
        };
        let drop = WetDrop {
            triangle: 0,
            position: Vec3::new(20.0, -20.0, 0.0),
            radius: 3.0,
        };
        let w = PartWeather::new(0, vec![1, 1], vec![[0; 3]; 6], 70.0, 0.0, vec![drop]).unwrap();
        scene.set_wet_parts(vec![w]).unwrap();
        let caps = scene.caps().unwrap();
        assert_eq!((caps.mesh, caps.instance, caps.material), (1, 1, 1));
        assert_eq!(scene.materials[1], water());
        assert_eq!(scene.file_instances().len(), 1);
        // The cap stands on the plate where the instance put it.
        let ray = Ray::new(Vec3::new(20.0, -20.0, 100.0), Vec3::new(0.0, 0.0, -1.0));
        let hit = scene.pick(&ray).unwrap();
        assert_eq!(hit.instance, 1);
        let height = 3.0 / 70f32.to_radians().sin() * (1.0 - 70f32.to_radians().cos());
        assert!(
            (hit.point.z - 30.0 - height).abs() < 0.05,
            "{:?}",
            hit.point
        );
        // A shadow ray from the plate under the drop goes out through its cap, keeping most of the
        // light (the Fresnel of water), as through a thin wall.
        let prepared = Prepared::new(&scene);
        let tracer = BvhTracer {
            geometry: &scene.geometry,
            isa: crate::simd::Isa::detect(),
        };
        let up = Ray::new(Vec3::new(20.0, -20.0, 30.01), Vec3::new(0.0, 0.0, 1.0));
        let keep = prepared
            .shadow_for_tests(&scene, &tracer, &up)
            .expect("not blocked");
        assert!(keep.g > 0.85 && keep.g < 1.0, "{keep:?}");
        // Taken away, nothing is left of it.
        scene.set_wet_parts(Vec::new()).unwrap();
        assert!(scene.caps().is_none());
        assert_eq!(scene.materials.len(), 1);
        assert_eq!(scene.pick(&ray).unwrap().instance, 0);
        // A part that is not there, or with other triangles, is refused and changes nothing.
        let bad = PartWeather::new(3, vec![1, 1], vec![[0; 3]; 6], 70.0, 0.0, vec![]).unwrap();
        assert!(scene.set_wet_parts(vec![bad]).is_err());
        let bad = PartWeather::new(0, vec![1], vec![[0; 3]; 3], 70.0, 0.0, vec![]).unwrap();
        assert!(scene.set_wet_parts(vec![bad]).is_err());
        assert!(scene.wet_parts.is_empty());
    }
    #[test]
    fn a_wetf_section_goes_and_comes_back_and_bad_ones_are_refused() {
        let drops = vec![
            FallingDrop {
                instance: 2,
                position: Vec3::new(1.0, -2.0, 30.0),
                radius: 0.7,
            },
            FallingDrop {
                instance: NO_INSTANCE,
                position: Vec3::new(0.0, 0.0, 5.0),
                radius: 2.0,
            },
        ];
        let bytes = encode_falling(&drops);
        assert_eq!(bytes.len(), WETF_HEADER + 2 * WETF_DROP_BYTES);
        assert_eq!(decode_falling(&bytes), Ok(drops.clone()));
        // A newer writer's tail is ignored.
        let mut longer = bytes.clone();
        longer.extend_from_slice(&[0; 8]);
        assert_eq!(decode_falling(&longer), Ok(drops.clone()));
        assert!(decode_falling(&bytes[..bytes.len() - 1]).is_err());
        let mut bad = bytes.clone();
        bad[20..24].copy_from_slice(&0.0f32.to_bits().to_le_bytes()); // a radius of 0
        assert!(decode_falling(&bad).is_err());
        assert!(check_falling(&drops, 3).is_ok());
        assert!(check_falling(&drops, 2).is_err(), "instance 2 is not there");
    }

    #[test]
    fn a_drop_in_the_air_is_a_sphere_after_the_caps_and_the_passes_name_their_parts() {
        use crate::geometry::{Geometry, Instance, Transform};
        use crate::integrator::{first_hit, BvhTracer, FirstHit, Prepared};
        use crate::math::Ray;
        // Two plates side by side: instance 0 at x < 0, instance 1 at x > 0, 30 mm up.
        let at = |x: f32| Transform {
            rows: [
                [1.0, 0.0, 0.0, x],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 30.0],
            ],
        };
        let mut scene = Scene {
            geometry: Geometry::new(
                vec![plate(40.0)],
                vec![
                    Instance::new(0, at(-50.0), 0),
                    Instance::new(0, at(50.0), 0),
                ],
            )
            .unwrap(),
            materials: vec![Material::default()],
            ..Scene::default()
        };
        // A drop on instance 1, and two in the air: one that left instance 0, one from nowhere.
        let on = WetDrop {
            triangle: 0,
            position: Vec3::new(20.0, -20.0, 0.0),
            radius: 3.0,
        };
        let w = PartWeather::new(1, vec![1, 1], vec![[0; 3]; 6], 70.0, 0.0, vec![on]).unwrap();
        scene.set_wet_parts(vec![w]).unwrap();
        scene
            .set_wet_falling(vec![
                FallingDrop {
                    instance: 0,
                    position: Vec3::new(-50.0, 0.0, 60.0),
                    radius: 2.0,
                },
                FallingDrop {
                    instance: NO_INSTANCE,
                    position: Vec3::new(0.0, 0.0, 60.0),
                    radius: 2.0,
                },
            ])
            .unwrap();
        let caps = scene.caps().unwrap();
        assert_eq!((caps.instance, caps.caps), (2, 1));
        let mesh = &scene.geometry.meshes()[caps.mesh as usize];
        assert_eq!(
            mesh.triangle_count() as u32,
            CAP_TRIANGLES + 2 * SPHERE_TRIANGLES
        );
        let prepared = Prepared::new(&scene);
        let tracer = BvhTracer {
            geometry: &scene.geometry,
            isa: crate::simd::Isa::detect(),
        };
        let down = |x: f32, y: f32| Ray::new(Vec3::new(x, y, 200.0), Vec3::new(0.0, 0.0, -1.0));
        let met = |ray: &Ray| match first_hit(&scene, &prepared, &tracer, ray) {
            FirstHit::Surface { instance, t, .. } => (instance, ray.origin.z - t),
            other => panic!("{other:?}"),
        };
        // The sphere in the air: its top at 62 mm, named as instance 0 (the part it left).
        let (inst, z) = met(&down(-50.0, 0.0));
        assert_eq!(inst, 0);
        assert!((z - 62.0).abs() < 0.05, "{z}");
        // The one from nowhere: the drops' own instance.
        assert_eq!(met(&down(0.0, 0.0)).0, caps.instance);
        // The cap on instance 1: named as instance 1, not as the caps'.
        let (inst, z) = met(&down(70.0, -20.0));
        assert_eq!(inst, 1);
        assert!(z > 30.5, "{z}");
        // The sphere is a sphere: a ray along X through its centre meets it at its radius.
        let side = Ray::new(Vec3::new(-150.0, 0.0, 60.0), Vec3::new(1.0, 0.0, 0.0));
        let hit = scene.pick(&side).unwrap();
        assert_eq!(hit.instance, caps.instance);
        assert!((hit.point.x + 52.0).abs() < 0.05, "{:?}", hit.point);
        // A shadow ray up from the plate under it goes through it, as through a cap.
        let up = Ray::new(Vec3::new(-50.0, 0.0, 30.01), Vec3::new(0.0, 0.0, 1.0));
        let keep = prepared
            .shadow_for_tests(&scene, &tracer, &up)
            .expect("not blocked");
        assert!(keep.g > 0.85, "{keep:?}");
        // Taken away, the cap stays and the spheres go.
        scene.set_wet_falling(Vec::new()).unwrap();
        let caps = scene.caps().unwrap();
        assert_eq!(
            scene.geometry.meshes()[caps.mesh as usize].triangle_count() as u32,
            CAP_TRIANGLES
        );
        assert_eq!(scene.cap_owners, vec![1]);
        // A drop in the air from an instance that is not there is refused and changes nothing.
        let bad = FallingDrop {
            instance: 7,
            position: Vec3::ZERO,
            radius: 1.0,
        };
        assert!(scene.set_wet_falling(vec![bad]).is_err());
        assert!(scene.wet_falling.is_empty());
    }

    /// S3f: a shape of every kind.
    fn shapes() -> Vec<DropShape> {
        vec![
            DropShape {
                axis: Vec3::new(1.0, 0.0, 0.0),
                aspect: 2.2,
                bulge: 0.12,
                taper: 0.3,
                ..DropShape::ROUND
            },
            DropShape {
                merge_axis: Vec3::new(0.0, 1.0, 0.0),
                merge_along: 1.5,
                merge_across: 0.8,
                neck: 0.5,
                shift: 0.4,
                ..DropShape::ROUND
            },
            DropShape {
                sag: 0.8,
                pinch: 0.5,
                ..DropShape::ROUND
            },
        ]
    }

    #[test]
    fn a_shape_tail_goes_and_comes_back_an_old_reader_skips_it_and_bad_ones_are_refused() {
        let drop = |x: f32| WetDrop {
            triangle: 0,
            position: Vec3::new(x, 0.0, 0.0),
            radius: 1.5,
        };
        let plain = PartWeather::new(
            2,
            vec![2],
            vec![[0; 3]; 6],
            60.0,
            0.0,
            vec![drop(0.0), drop(5.0), drop(9.0)],
        )
        .unwrap();
        let shaped = plain.clone().with_shapes(shapes()).unwrap();
        let bytes = shaped.encode();
        assert_eq!(PartWeather::decode(&bytes), Ok(shaped.clone()));
        // Without shapes, the S3c layout, byte for byte; the tail comes after it, so a reader of
        // before (which stops at the drops) reads the same drops, round.
        let old = plain.encode();
        assert_eq!(bytes[..old.len()], old[..]);
        assert_eq!(&bytes[old.len()..old.len() + 4], &SHAPE_TAG);
        assert_eq!(bytes.len(), old.len() + 8 + 3 * 4 * SHAPE_FLOATS);
        assert_eq!(PartWeather::decode(&old), Ok(plain.clone()));
        // Other trailing bytes are still a newer writer's, ignored.
        let mut other = old.clone();
        other.extend_from_slice(b"XXXX\x01\0\0\0");
        assert_eq!(PartWeather::decode(&other), Ok(plain.clone()));
        // A tail that is not one per drop, cut short, or out of its range is refused.
        let mut bad = bytes.clone();
        bad[old.len() + 4] = 2;
        assert!(PartWeather::decode(&bad).is_err());
        assert!(PartWeather::decode(&bytes[..bytes.len() - 4]).is_err());
        let mut bad = bytes.clone();
        let aspect = old.len() + 8 + 4 * 3;
        bad[aspect..aspect + 4].copy_from_slice(&0.5f32.to_bits().to_le_bytes());
        assert!(PartWeather::decode(&bad).is_err());
        assert!(plain.clone().with_shapes(vec![DropShape::ROUND]).is_err());
    }

    /// The volume under a cap's mesh: its triangles' cones from the centre of its contact circle.
    fn cap_volume_of(mesh: &Mesh, base: Vec3) -> f32 {
        (0..mesh.triangle_count())
            .map(|t| {
                let [a, b, c] = mesh.triangle(t).unwrap();
                (a - base).dot((b - base).cross(c - base)) / 6.0
            })
            .sum::<f32>()
            .abs()
    }

    #[test]
    fn a_shaped_cap_keeps_its_volume_and_takes_its_shape() {
        let cap = |shape: Option<DropShape>| Cap {
            centre: Vec3::ZERO,
            normal: Vec3::new(0.0, 0.0, 1.0),
            radius: 2.0,
            angle_deg: 60.0,
            shape,
        };
        let round = cap_mesh(&[cap(Some(DropShape::ROUND))]).unwrap();
        assert_eq!(round.triangle_count() as u32, SHAPED_CAP_TRIANGLES);
        let v0 = cap_volume_of(&round, Vec3::ZERO);
        // A round cap of 60° and 2 mm: π a³ (2 − 3 cos θ + cos³ θ) / (3 sin³ θ), within its mesh.
        let exact = std::f32::consts::PI * 8.0 * (2.0 - 1.5 + 0.125) / (3.0 * 0.75f32.powf(1.5));
        assert!((v0 / exact - 1.0).abs() < 0.04, "{v0} vs {exact}");
        let points = |m: &Mesh| -> Vec<Vec3> {
            (0..m.vertex_count())
                .map(|i| m.position(i).unwrap())
                .collect()
        };
        let extent = |p: &[Vec3], d: Vec3| {
            p.iter().map(|q| q.dot(d)).fold(f32::NEG_INFINITY, f32::max)
                - p.iter().map(|q| q.dot(d)).fold(f32::INFINITY, f32::min)
        };
        let all = shapes();
        for (k, s) in all.iter().enumerate() {
            let m = cap_mesh(&[cap(Some(*s))]).unwrap();
            let v = cap_volume_of(&m, Vec3::ZERO);
            assert!((v / v0 - 1.0).abs() < 0.04, "{k}: {v} vs {v0}");
            for i in 0..m.vertex_count() {
                let n = m.normal(i).unwrap();
                assert!((n.length() - 1.0).abs() < 1e-3, "{k}: {n:?}");
            }
        }
        // Sliding along +X: longer along it than across, its head (+X) wider than its tail, its top
        // sheared forward.
        let p = points(&cap_mesh(&[cap(Some(all[0]))]).unwrap());
        let (x, y) = (Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0));
        assert!(extent(&p, x) > 1.9 * extent(&p, y));
        let width_at = |pts: &[Vec3], sign: f32| {
            pts.iter()
                .filter(|q| q.x * sign > 0.6 && q.z < 0.05)
                .map(|q| q.y.abs())
                .fold(0.0f32, f32::max)
        };
        assert!(width_at(&p, 1.0) > width_at(&p, -1.0) * 1.2);
        assert!(p[0].x > 0.1, "{:?}", p[0]);
        // A neck between two lobes along +Y: narrower across its middle than at its lobes.
        let p = points(&cap_mesh(&[cap(Some(all[1]))]).unwrap());
        // (Its contact line: the neck at the middle of the two, the lobes away from it.)
        let mid = 0.4 * 2.0;
        let width = |near: bool| {
            p.iter()
                .filter(|q| q.z < 0.05 && ((q.y - mid).abs() < 0.3) == near)
                .map(|q| q.x.abs())
                .fold(0.0f32, f32::max)
        };
        assert!(
            width(true) < 0.85 * width(false),
            "{} vs {}",
            width(true),
            width(false)
        );
        // Hanging from a ceiling (its normal down, gravity along it): longer along gravity than a
        // round cap is tall; S3g: its contact line where the round cap's is, thinner across above
        // it.
        let hanging = |shape| Cap {
            normal: Vec3::new(0.0, 0.0, -1.0),
            ..cap(shape)
        };
        let r = points(&cap_mesh(&[hanging(Some(DropShape::ROUND))]).unwrap());
        let h = points(&cap_mesh(&[hanging(Some(all[2]))]).unwrap());
        let z = Vec3::new(0.0, 0.0, 1.0);
        assert!(extent(&h, z) > 1.6 * extent(&r, z));
        let ring = |p: &[Vec3]| {
            p.iter()
                .filter(|q| q.z.abs() < 1e-4)
                .map(|q| q.x.abs())
                .fold(0.0f32, f32::max)
        };
        assert!(
            (ring(&h) - ring(&r)).abs() < 1e-4,
            "{} vs {}",
            ring(&h),
            ring(&r)
        );
        let below = |p: &[Vec3], depth: f32| {
            p.iter()
                .filter(|q| q.z < -depth)
                .map(|q| q.x.abs())
                .fold(0.0f32, f32::max)
        };
        let half = 0.5 * extent(&r, z);
        assert!(
            below(&h, half) < below(&r, half),
            "{} vs {}",
            below(&h, half),
            below(&r, half)
        );
        // And a round shape is the round cap.
        assert!(DropShape::ROUND.is_round() && !all.iter().any(DropShape::is_round));
    }

    #[test]
    fn the_passes_count_shaped_caps_by_their_own_triangles() {
        use crate::geometry::{Geometry, Instance, Transform};
        let at = |x: f32| Transform {
            rows: [
                [1.0, 0.0, 0.0, x],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 30.0],
            ],
        };
        let mut scene = Scene {
            geometry: Geometry::new(
                vec![plate(40.0)],
                vec![
                    Instance::new(0, at(-50.0), 0),
                    Instance::new(0, at(50.0), 0),
                ],
            )
            .unwrap(),
            materials: vec![Material::default()],
            ..Scene::default()
        };
        let drop = WetDrop {
            triangle: 0,
            position: Vec3::new(20.0, -20.0, 0.0),
            radius: 3.0,
        };
        let one = |instance| {
            PartWeather::new(instance, vec![1, 1], vec![[0; 3]; 6], 70.0, 0.0, vec![drop])
                .unwrap()
                .with_shapes(vec![shapes()[0]])
                .unwrap()
        };
        scene.set_wet_parts(vec![one(0), one(1)]).unwrap();
        let caps = scene.caps().unwrap();
        assert_eq!((caps.caps, caps.cap_triangles), (2, SHAPED_CAP_TRIANGLES));
        assert_eq!(
            scene.geometry.meshes()[caps.mesh as usize].triangle_count() as u32,
            2 * SHAPED_CAP_TRIANGLES
        );
        // The first cap's triangles are instance 0's, the second's instance 1's.
        assert_eq!(scene.pass_instance(caps.instance, 5), 0);
        assert_eq!(
            scene.pass_instance(caps.instance, SHAPED_CAP_TRIANGLES - 1),
            0
        );
        assert_eq!(
            scene.pass_instance(caps.instance, SHAPED_CAP_TRIANGLES + 5),
            1
        );
        assert_eq!(
            scene.pass_instance(caps.instance, 2 * SHAPED_CAP_TRIANGLES - 1),
            1
        );
    }
}

#[cfg(test)]
#[path = "weather_s3e_tests.rs"]
mod s3e_tests;

#[cfg(test)]
#[path = "weather_s3g_tests.rs"]
mod s3g_tests;

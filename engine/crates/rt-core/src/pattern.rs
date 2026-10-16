//! Procedural patterns of the shading (E6): the wood and cloth recipes of the catalogue as
//! functions of the point, with their own noise ([`noise`]).
//!
//! A material may carry one pattern (`PATN` section of the RSB, [`Pattern`]): it replaces the
//! material's base colour at every point, scales its roughness a little, and tilts the shading
//! normal by the relief of the pattern (a bump: the finite differences of its height along the
//! tangent plane, on top of the bevel and the terminator of [`crate::bevel`]). The geometric
//! normal and the point rays leave from do not change.
//!
//! **Where the pattern lies.** In the mesh's own space, so it sticks to the part, in millimetres
//! (the instance's scale `∛|det M|` converts). [`wood`]: the pith runs along the longest side of
//! the mesh's box, 0.8 of that side below the box's centre along its shortest side and 0.35 of it
//! aside along the third (never through the piece), so a board shows the arches of flat-sawn wood
//! on its faces and the straight lines of quarter-sawn wood on its edges, and a ball nested arcs
//! rather than a target. Its knots ([`knots`]) are placed in that frame, in the mesh's box.
//! [`cloth`]: a box projection on the mesh's axes (the plane of the two axes across the largest
//! component of the interpolated normal), blended over the narrow band where two components are
//! close; the warp runs along the plane's second axis (upright on the sides, along `y` on top).
//!
//! The camera paths use it, the albedo pass shows its colour; the photons of the caustics see the
//! material's plain colour (patterned materials are receivers, whose colour the gather takes from
//! the camera path).

pub mod cloth;
pub mod knots;
pub mod noise;
pub mod wood;

use crate::bevel::{ShadingPoint, MIN_FACING};
use crate::color::Rgb;
use crate::geometry::{Geometry, Hit};
use crate::math::{Frame, Ray, Vec3};
use crate::scene::{Material, Scene};
use cloth::{Cloth, Weave};
use knots::{KnotSpec, Knots};
use wood::Wood;

/// `PATN.kind` 1: wood ([`wood`]).
pub const PATTERN_WOOD: u32 = 1;
/// `PATN.kind` 2: cloth ([`cloth`]).
pub const PATTERN_CLOTH: u32 = 2;

/// A procedural pattern of a material (`PATN`). See the [`crate::scene::rsb`] documentation for
/// the layout.
#[derive(Clone, Debug, PartialEq)]
pub struct Pattern {
    /// The material it belongs to (index among the `MATL` sections).
    pub material: u32,
    /// [`PATTERN_WOOD`] or [`PATTERN_CLOTH`]; other values draw nothing (newer files).
    pub kind: u32,
    /// Wood: the spring wood (light). Cloth: the warp (`threadColor1`). Linear RGB.
    pub color_a: Rgb,
    /// Wood: the summer wood (dark). Cloth: the weft (`threadColor2`).
    pub color_b: Rgb,
    /// Wood: the ring spacing (the strip width of bamboo). Cloth: the distance between threads
    /// (between stitches, the size of felt's fibres). Millimetres.
    pub scale_mm: f32,
    /// Wood: ring variation, ring noise, axial noise, colour noise, contrast (0: the colours as
    /// given), pore width (mm, 0: none), pore depth, pore band (0 diffuse- to 1 ring-porous),
    /// fibre, anisotropy along the grain; knots: count (0 to 12), diameter (mm), variation of
    /// the diameter (± fraction), darkness; two unused (0). Cloth: relief, the yarn's twist (0 smooth
    /// filaments to 1), then fourteen unused (0).
    pub params: [f32; PARAMS],
    /// Wood: the figure ([`wood::Figure`]: 0 rings, 1 strips, 2 speckle, 3 streaked). Cloth:
    /// the weave ([`Weave`]: 0 plain, 1 twill 2/2, 2 satin, 3 canvas, 4 knit, 5 felt, 6 twill 3/1).
    pub variant: u32,
    /// The material's seed (where the knots are).
    pub seed: u32,
}

/// Number of `PATN.params`.
pub const PARAMS: usize = 16;

impl Default for Pattern {
    fn default() -> Pattern {
        Pattern {
            material: 0,
            kind: PATTERN_WOOD,
            color_a: Rgb::new(0.56, 0.38, 0.21),
            color_b: Rgb::new(0.3, 0.18, 0.09),
            scale_mm: 3.0,
            params: [
                0.4, 0.3, 0.2, 0.2, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            ],
            variant: 0,
            seed: 0,
        }
    }
}

/// The recipe of a pattern, decoded.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Recipe {
    /// A wood, the anisotropy of its roughness along the grain, and its knots.
    Wood(Wood, f32, KnotSpec),
    /// A cloth.
    Cloth(Cloth),
}

impl Pattern {
    fn recipe(&self) -> Option<Recipe> {
        if !(self.scale_mm > 0.0 && self.scale_mm.is_finite()) {
            return None;
        }
        let v = self
            .params
            .map(|v| if v.is_finite() { v.max(0.0) } else { 0.0 });
        match self.kind {
            PATTERN_WOOD => Some(Recipe::Wood(
                Wood {
                    light: self.color_a,
                    dark: self.color_b,
                    ring_mm: self.scale_mm,
                    ring_variation: v[0],
                    ring_noise: v[1],
                    axial_noise: v[2],
                    color_noise: v[3],
                    contrast: v[4],
                    pore_mm: v[5],
                    pore_depth: v[6],
                    pore_band: v[7].min(1.0),
                    fibre: v[8],
                    figure: wood::Figure::from_u32(self.variant),
                },
                v[9].min(1.0),
                KnotSpec {
                    // Only trees with rings have branches (not bamboo, fibreboard or ebony).
                    count: if self.variant == 0 {
                        (v[10].round().min(knots::MAX_KNOTS as f32)) as u32
                    } else {
                        0
                    },
                    diameter_mm: v[11],
                    variation: v[12].min(1.0),
                    darkness: v[13].min(1.0),
                    seed: self.seed,
                },
            )),
            PATTERN_CLOTH => Some(Recipe::Cloth(Cloth {
                warp: self.color_a,
                weft: self.color_b,
                pitch_mm: self.scale_mm,
                relief: v[0].min(1.0),
                twist: v[1].clamp(0.0, 1.0),
                weave: Weave::from_u32(self.variant),
            })),
            _ => None,
        }
    }
}

/// What a pattern makes of a material at a point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tint {
    /// The base colour there.
    pub base_color: Rgb,
    /// The multiplier of the roughness there.
    pub roughness: f32,
    /// Added to the roughness there after the multiplier (a knot's end grain).
    pub roughness_add: f32,
    /// The anisotropy of the roughness there (0: the material's own).
    pub anisotropy: f32,
    /// The world direction the roughness is stretched along (the grain), with `anisotropy`.
    pub tangent: Option<Vec3>,
}

impl Tint {
    /// `material` with this colour, roughness and anisotropy.
    pub fn apply(&self, material: &Material) -> Material {
        Material {
            base_color: self.base_color,
            roughness: (material.roughness * self.roughness + self.roughness_add).clamp(0.0, 1.0),
            anisotropy: if self.anisotropy > 0.0 {
                self.anisotropy
            } else {
                material.anisotropy
            },
            ..material.clone()
        }
    }

    /// The shading frame at a point of normal `n`: the tangent along the grain where the pattern
    /// stretches the roughness, `None` to keep the integrator's own.
    pub fn frame(&self, n: Vec3) -> Option<Frame> {
        let t = self.tangent?;
        let t = t - n * n.dot(t);
        if t.length_squared() <= 1.0e-12 || self.anisotropy <= 0.0 {
            return None;
        }
        let x = t.normalize();
        Some(Frame {
            x,
            y: n.cross(x),
            z: n,
        })
    }
}

/// The pattern of one instance, placed in its mesh's space.
#[derive(Clone, Debug, PartialEq)]
struct Placed {
    recipe: Recipe,
    /// Origin of the pattern's frame, mesh space.
    origin: Vec3,
    /// Wood: across, across, along the pith. Cloth: the mesh's axes.
    axes: [Vec3; 3],
    /// Millimetres per unit of mesh space.
    mm: f32,
    /// Wood: its knots, in its frame.
    knots: Knots,
}

/// The patterns of every instance of a scene, prepared once per scene
/// ([`crate::integrator::Prepared`]).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PatternSetup {
    instances: Vec<Option<Placed>>,
}

const AXES: [Vec3; 3] = [
    Vec3::new(1.0, 0.0, 0.0),
    Vec3::new(0.0, 1.0, 0.0),
    Vec3::new(0.0, 0.0, 1.0),
];

impl PatternSetup {
    /// The pattern of every instance whose material has one (the first `PATN` of a material).
    pub fn new(scene: &Scene) -> PatternSetup {
        let geometry = &scene.geometry;
        let instances = geometry
            .instances()
            .iter()
            .enumerate()
            .map(|(i, inst)| {
                let m = scene.materials.get(inst.material_id as usize)?;
                if m.is_emissive() {
                    return None;
                }
                let pattern = scene
                    .patterns
                    .iter()
                    .find(|p| p.material == inst.material_id)?;
                let recipe = pattern.recipe()?;
                let (mesh, _) = geometry.instance_mesh(i as u32)?;
                let bounds = mesh.bounds();
                let mm = crate::bevel::instance_scale(geometry, i as u32);
                let size = bounds.max - bounds.min;
                let (origin, axes) = match recipe {
                    Recipe::Wood(..) => wood_frame(bounds.min, size, mm),
                    Recipe::Cloth(_) => (bounds.min, AXES),
                };
                let knots = match &recipe {
                    Recipe::Wood(_, _, spec) if spec.count > 0 => {
                        let centre = bounds.min + size * 0.5 - origin;
                        let frame =
                            |v: Vec3| Vec3::new(v.dot(axes[0]), v.dot(axes[1]), v.dot(axes[2]));
                        let half = frame(size * 0.5);
                        let half = Vec3::new(half.x.abs(), half.y.abs(), half.z.abs());
                        // Back from the frame (mm) to the mesh, then to the world.
                        let to_mesh = |q: Vec3| {
                            origin + (axes[0] * q.x + axes[1] * q.y + axes[2] * q.z) * (1.0 / mm)
                        };
                        Knots::place(spec, frame(centre) * mm, half * mm, |k, t0, t1| {
                            meets_surface(
                                geometry,
                                i as u32,
                                to_mesh(k.origin + k.axis * t0),
                                to_mesh(k.origin + k.axis * t1),
                            )
                        })
                    }
                    _ => Knots::none(),
                };
                Some(Placed {
                    recipe,
                    origin,
                    axes,
                    mm,
                    knots,
                })
            })
            .collect();
        PatternSetup { instances }
    }

    /// True when no instance has a pattern.
    pub fn is_empty(&self) -> bool {
        self.instances.iter().all(Option::is_none)
    }

    /// How many knots each instance got (fewer than asked when no more fit its piece).
    pub fn knot_counts(&self) -> Vec<usize> {
        self.instances
            .iter()
            .map(|p| p.as_ref().map_or(0, |p| p.knots.list.len()))
            .collect()
    }

    /// The pattern at the hit `details` of `ray`: its colour and roughness, and the shading
    /// normal of `shade` tilted by its relief. `None` (and `shade` untouched) without a pattern.
    pub fn apply(
        &self,
        scene: &Scene,
        ray: &Ray,
        details: &Hit,
        shade: &mut ShadingPoint,
    ) -> Option<Tint> {
        let placed = self.instances.get(details.instance as usize)?.as_ref()?;
        let geometry = &scene.geometry;
        let (p, smooth) = local_point(geometry, details)?;
        let mut ns = geometry
            .normal_to_object(details.instance, shade.normal)
            .normalize();
        if !ns.is_finite() || ns == Vec3::ZERO {
            ns = smooth;
        }
        let (mut tint, slope) = placed.sample(p, ns, smooth);
        tint.tangent = tint
            .tangent
            .map(|t| geometry.vector_to_world(details.instance, t).normalize());
        if let Some(g) = slope {
            let tangent = g - ns * ns.dot(g);
            let bumped = (ns - tangent).normalize();
            let n = geometry
                .normal_to_world(details.instance, bumped)
                .normalize();
            let to_viewer = -ray.dir.normalize();
            let c = n.dot(to_viewer);
            let n = if c < MIN_FACING {
                (n + to_viewer * (MIN_FACING - c)).normalize()
            } else {
                n
            };
            if n.is_finite() {
                shade.normal = n;
            }
        }
        Some(tint)
    }

    /// The pattern's colour at the hit (the albedo pass), `None` without a pattern.
    pub fn albedo(&self, scene: &Scene, details: &Hit) -> Option<Rgb> {
        let placed = self.instances.get(details.instance as usize)?.as_ref()?;
        let (p, smooth) = local_point(&scene.geometry, details)?;
        Some(placed.color_only(p, smooth))
    }
}

/// True when the segment `a b` (mesh space of instance `instance`, through its box) crosses
/// the instance's surface, and every time at [`knots::MIN_INCIDENCE`] or more against the
/// triangle's plane (in the world). The segment is followed a little beyond both ends (2 % and
/// 0.01 mm), in case a face lies on the box.
fn meets_surface(geometry: &Geometry, instance: u32, a: Vec3, b: Vec3) -> bool {
    let Some(inst) = geometry.instances().get(instance as usize) else {
        return false;
    };
    let (wa, wb) = (inst.transform.point(a), inst.transform.point(b));
    let length = (wb - wa).length();
    if !(length > 0.0 && length.is_finite()) {
        return false;
    }
    let dir = (wb - wa) * (1.0 / length);
    let reach = 0.02 * length + 1.0e-2;
    let step = 1.0e-4 * length + 1.0e-4;
    let mut from = wa - dir * reach;
    let mut left = length + 2.0 * reach;
    let mut crossed = false;
    for _ in 0..64 {
        let ray = Ray {
            origin: from,
            dir,
            t_min: 0.0,
            t_max: left,
        };
        let Some(hit) = geometry.intersect(&ray) else {
            break;
        };
        if hit.instance == instance {
            if hit.geometric_normal.dot(dir).abs() < knots::MIN_INCIDENCE {
                return false;
            }
            crossed = true;
        }
        from = hit.point + dir * step;
        left -= hit.t + step;
        if left <= 0.0 {
            break;
        }
    }
    crossed
}

/// The hit's point and its interpolated normal (facing the ray; before any bevel or bump), in
/// mesh space.
fn local_point(geometry: &Geometry, details: &Hit) -> Option<(Vec3, Vec3)> {
    let (mesh, _) = geometry.instance_mesh(details.instance)?;
    let [p0, p1, p2] = mesh.triangle(details.triangle as usize)?;
    let [b0, b1, b2] = details.barycentrics;
    let sign = if details.front_face { 1.0 } else { -1.0 };
    let ng = crate::geometry::edges::winding_normal(mesh, details.triangle) * sign;
    let smooth = geometry
        .normal_to_object(details.instance, details.normal)
        .normalize();
    let smooth = if smooth.is_finite() && smooth != Vec3::ZERO {
        smooth
    } else {
        ng
    };
    Some((p0 * b0 + p1 * b1 + p2 * b2, smooth))
}

/// Largest distance from the pith to a part's centre across its thickness, millimetres (a log's
/// radius).
pub const MAX_PITH_MM: f32 = 250.0;
/// The pith's offset aside over its offset below (0.35 over 0.8 of the longest side).
const ASIDE: f32 = 0.35 / 0.8;

/// The wood frame of a mesh's box (`min`, `size`, in mesh units of `mm` millimetres): the pith
/// along the longest side, 0.8 of it (at most [`MAX_PITH_MM`], at least 0.75 of the shortest side,
/// so it never runs through the piece) below the centre along the shortest side, and 0.35 of the
/// longest side (scaled as the first offset is) aside along the third, towards `-` that axis
/// (the front of most product shots: the far side of a ball shows its rings' centre).
fn wood_frame(min: Vec3, size: Vec3, mm: f32) -> (Vec3, [Vec3; 3]) {
    let s = [size.x, size.y, size.z];
    let long = if s[0] >= s[1] && s[0] >= s[2] {
        0
    } else if s[1] >= s[2] {
        1
    } else {
        2
    };
    let (o1, o2) = ((long + 1) % 3, (long + 2) % 3);
    let (short, side) = if s[o1] < s[o2] { (o1, o2) } else { (o2, o1) };
    let length = s[long].max(1.0e-6);
    let offset = (0.8 * length)
        .min(MAX_PITH_MM / mm.max(1.0e-6))
        .max(0.75 * s[short]);
    let centre = min + size * 0.5;
    let pith = centre - AXES[short] * offset - AXES[side] * (ASIDE * offset);
    (pith, [AXES[side], AXES[short], AXES[long]])
}

/// Box-projection weights of a normal: `|n_i|⁸`, normalised.
fn projection_weights(n: Vec3) -> [f32; 3] {
    let w = [n.x.abs(), n.y.abs(), n.z.abs()].map(|v| {
        let v2 = v * v;
        let v4 = v2 * v2;
        v4 * v4
    });
    let total = w[0] + w[1] + w[2];
    if total > 0.0 {
        w.map(|v| v / total)
    } else {
        [0.0, 0.0, 1.0]
    }
}

/// The two axes of the projection plane across axis `k`: `(u, v)`, the warp along `v`.
fn plane_axes(k: usize) -> (usize, usize) {
    match k {
        0 => (1, 2),
        1 => (0, 2),
        _ => (0, 1),
    }
}

/// Step of the finite differences of a wood's height, millimetres.
const WOOD_STEP_MM: f32 = 0.02;
/// Step of the finite differences of a cloth's height, in pitches.
const CLOTH_STEP: f32 = 0.05;
/// Anisotropy of a cloth's roughness, wider across the thread on top (Burley's `a`).
const CLOTH_ANISOTROPY: f32 = 0.5;
/// Projections weighing less than this are skipped.
const MIN_WEIGHT: f32 = 0.02;

impl Placed {
    /// The point in the pattern's frame, millimetres.
    fn frame_point(&self, p: Vec3) -> Vec3 {
        let d = p - self.origin;
        Vec3::new(
            d.dot(self.axes[0]),
            d.dot(self.axes[1]),
            d.dot(self.axes[2]),
        ) * self.mm
    }

    /// The tint at `p` (mesh space; `ns` the shading normal, `smooth` the interpolated one,
    /// which places a cloth's projection) and the gradient of the relief there, in mesh space, if
    /// it has one.
    fn sample(&self, p: Vec3, ns: Vec3, smooth: Vec3) -> (Tint, Option<Vec3>) {
        match &self.recipe {
            Recipe::Wood(w, anisotropy, _) => {
                let q = self.frame_point(p);
                let s = w.sample(q, &self.knots);
                // Roughness: the pores are rougher, the summer wood a touch smoother (a few per
                // cent: more draws the rings as ridges in the highlights).
                let rough = (1.0 + 0.08 * (wood::MEAN_DARK - s.dark)) * (1.0 - s.height * 4.0);
                let tint = Tint {
                    base_color: s.color,
                    roughness: rough,
                    roughness_add: s.rough_add,
                    anisotropy: *anisotropy,
                    tangent: (*anisotropy > 0.0).then_some(self.axes[2]),
                };
                if !w.has_relief(&self.knots) {
                    return (tint, None);
                }
                let frame = Frame::from_normal(ns);
                let step = WOOD_STEP_MM / self.mm;
                let ring = s.ring;
                let h0 = s.height;
                let h1 = w.height(self.frame_point(p + frame.x * step), ring, &self.knots);
                let h2 = w.height(self.frame_point(p + frame.y * step), ring, &self.knots);
                let k = 1.0 / WOOD_STEP_MM;
                let g = frame.x * ((h1 - h0) * k) + frame.y * ((h2 - h0) * k);
                (tint, Some(g))
            }
            Recipe::Cloth(c) => {
                let weights = projection_weights(smooth);
                let (mut color, mut rough, mut grad, mut total) =
                    (Rgb::BLACK, 0.0f32, Vec3::ZERO, 0.0f32);
                let d = (p - self.origin) * self.mm;
                let at = [d.x, d.y, d.z];
                let step = CLOTH_STEP * c.pitch_mm;
                // The highlight is stretched across the thread on top (where its fibres' normals
                // spread), in the projection that weighs most.
                let (mut tangent, mut heaviest) = (None, 0.0f32);
                for (k, &w) in weights.iter().enumerate() {
                    if w < MIN_WEIGHT {
                        continue;
                    }
                    let (a, b) = plane_axes(k);
                    let (u, v) = (at[a], at[b]);
                    let s = c.sample(u, v);
                    if w > heaviest {
                        heaviest = w;
                        tangent = Some(if s.along_v { AXES[a] } else { AXES[b] });
                    }
                    color += s.color * w;
                    rough += s.roughness * w;
                    total += w;
                    if c.relief > 0.0 {
                        let du = (c.height(u + step, v) - s.height) / step;
                        let dv = (c.height(u, v + step) - s.height) / step;
                        grad += (AXES[a] * du + AXES[b] * dv) * w;
                    }
                }
                let k = if total > 0.0 { 1.0 / total } else { 1.0 };
                let tint = Tint {
                    base_color: color * k,
                    roughness: rough * k,
                    roughness_add: 0.0,
                    anisotropy: if c.has_threads() {
                        CLOTH_ANISOTROPY
                    } else {
                        0.0
                    },
                    tangent: tangent.filter(|_| c.has_threads()),
                };
                // The slope of a millimetre relief over millimetres: dimensionless, along the
                // mesh's axes (the bump keeps its part across the normal).
                (tint, (c.relief > 0.0).then_some(grad * k))
            }
        }
    }

    /// The colour alone at `p` (the albedo pass).
    fn color_only(&self, p: Vec3, smooth: Vec3) -> Rgb {
        self.sample(p, smooth, smooth).0.base_color
    }
}

#[cfg(test)]
mod tests;

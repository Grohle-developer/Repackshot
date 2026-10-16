//! What a material's textures make of a surface point (M2b), prepared once per scene
//! ([`TextureSetup`], held by [`crate::integrator::Prepared`]) and evaluated at every hit of a
//! textured instance, as `src/render/texture-shader.ts` does in the Fast preview:
//!
//! 1. **Slots.** The colour multiplies the base colour (an emitter's radiance instead), the
//!    roughness and the metal multiply theirs (the channel the slot reads, inverted if it says
//!    so), the alpha multiplies the opacity, or below `cutoff` makes it 0 (a cut-out), and the
//!    emission adds `tint × image × strength` to the radiance the surface sends. A box projection
//!    blends the texels of its three axes by their weights before any channel is read.
//! 2. **Normal.** A tangent-space normal map bends the shading normal in the frame of the
//!    coordinates' surface gradients (`T ∝ ∇u`, `B ∝ ∇v` in the tangent plane, both scaled by the
//!    longer one: the frame M. Schüler's derivatives build in Fast, "Followup: Normal Mapping
//!    Without Precomputed Tangents", 2013), `normalize(T·s·m.x + B·s·m.y + n·m.z)` with `m = 2 ·
//!    texel − 1` and `strength` on x and y; each axis of a box projection in its own frame, the
//!    three bent normals blended by its weights. A height map bumps it instead:
//!    `normalize(n − ∇ₛh)`, the surface gradient of `h = value · strength` (mm) by central
//!    differences of one texel of the level read (M. Mikkelsen, "Bump Mapping Unparametrized
//!    Surfaces on the GPU", 2010, is what Fast evaluates with screen derivatives). It works on
//!    the shading normal of [`crate::bevel`] and [`crate::pattern`] (the bevelled, patterned
//!    normal), turned to the outside of the part and back, so the relief reads the same from
//!    either side; the point rays leave from (the terminator's) and the geometric normal do not
//!    change.
//! 3. **Labels**, in order: each one's colour over what is under it by its alpha (`a` = the
//!    image's alpha where it reaches, 0 elsewhere); its roughness and clear coat replace the
//!    surface's in the same proportion; under the labels' coverage `A` the surface keeps
//!    `1 − A` of its metal, its transmission (paper is opaque) and its emission; and the paper's
//!    edge bumps the normal by `Σ aᵢ · reliefᵢ · LABEL_RELIEF_MM`.
//!
//! **Level of detail.** [`Footprint`] is the two axes of the area the ray stands for on the
//! surface (world space, in the tangent plane), a quarter of a pixel's
//! ([`FOOTPRINT_SCALE`]): the camera's ray differentials (H. Igehy, "Tracing Ray Differentials",
//! SIGGRAPH 1999) for a camera ray, transferred to the hit and projected onto its plane
//! ([`CameraCone::footprint`]); for a later ray, the width the path's cone has reached there
//! ([`Footprint::cone`]). Each read takes the level of `log2` of the longer axis in texels of the
//! image ([`super::image::TextureImage::lod`]) and blends the two levels around it.
//!
//! The photons of the caustics ([`crate::caustics`]) see the materials' plain values, as they do
//! the procedural patterns'.

use super::image::TextureImage;
use super::mapping::{LabelFrame, Mapping, Projected, UvAt};
use super::{
    MaterialTextures, LABEL_RELIEF_MM, SLOTS, SLOT_ALPHA, SLOT_COLOR, SLOT_EMISSION,
    SLOT_FLAG_CUTOUT, SLOT_FLAG_HEIGHT, SLOT_FLAG_INVERT, SLOT_METAL, SLOT_NORMAL, SLOT_ROUGHNESS,
    WRAP_CLAMP,
};
use crate::bevel::{ShadingPoint, MIN_FACING};
use crate::color::Rgb;
use crate::geometry::{Geometry, Hit};
use crate::math::{Frame, Ray, Vec3};
use crate::scene::{Material, Scene};
use std::sync::Arc;

/// The share of a pixel's footprint the texture reads are filtered over: a path tracer already
/// averages the samples over the pixel, so a whole pixel's filter on top of it would blur the
/// image twice; a quarter keeps it as sharp as the preview's one filtered sample per pixel.
pub const FOOTPRINT_SCALE: f32 = 0.25;
/// Least `|cos|` between a ray and the surface for the stretch of its footprint (76° beyond).
const MIN_COS: f32 = 0.05;

/// The area a ray stands for where it meets a surface: two vectors in the tangent plane, world
/// space (already scaled by [`FOOTPRINT_SCALE`]). Zero: read level 0.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Footprint {
    /// The first axis.
    pub dx: Vec3,
    /// The second axis.
    pub dy: Vec3,
}

impl Footprint {
    /// No footprint: every read on level 0 (shadow rays).
    pub const NONE: Footprint = Footprint {
        dx: Vec3::ZERO,
        dy: Vec3::ZERO,
    };

    /// The footprint of a cone `width` wide (across the ray) that arrives along `dir` (unit) at a
    /// surface of unit normal `n`: that width across, stretched by `1 / |cos|` along the
    /// direction the ray leans in.
    pub fn cone(dir: Vec3, width: f32, n: Vec3) -> Footprint {
        if !(width > 0.0 && width.is_finite()) {
            return Footprint::NONE;
        }
        let along = dir - n * n.dot(dir);
        let e1 = if along.length_squared() > 1.0e-12 {
            along.normalize()
        } else {
            Frame::from_normal(n).x
        };
        let e2 = n.cross(e1);
        let c = n.dot(dir).abs().max(MIN_COS);
        Footprint {
            dx: e1 * (width / c),
            dy: e2 * width,
        }
    }
}

/// The camera's ray differentials (Igehy 1999): how a camera ray changes from one pixel to the
/// next. A perspective camera is treated as its pinhole (a thin lens's rays through one point of
/// its aperture change the same way at the plane of focus, and blur elsewhere already); an
/// orthographic one moves its origins.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraCone {
    forward: Vec3,
    right: Vec3,
    up: Vec3,
    focal: f32,
    /// Sensor millimetres per pixel (perspective) or scene millimetres per pixel (orthographic).
    pixel: f32,
    ortho: bool,
}

impl Default for CameraCone {
    fn default() -> CameraCone {
        CameraCone::new(&Scene::default())
    }
}

impl CameraCone {
    /// The differentials of the scene's camera for its image size.
    pub fn new(scene: &Scene) -> CameraCone {
        let camera = &scene.camera;
        let (w, h) = (scene.render.width.max(1), scene.render.height.max(1));
        let (forward, right, up) = camera.basis();
        let pixel = if camera.ortho {
            camera.ortho_width / w as f32
        } else {
            // The sensor size is along the longer side, and pixels are square.
            camera.sensor_mm / w.max(h) as f32
        };
        CameraCone {
            forward,
            right,
            up,
            focal: camera.focal_mm.max(1.0e-3),
            pixel,
            ortho: camera.ortho,
        }
    }

    /// The spread of the camera's cone (radians per pixel, scaled): how fast the footprint of
    /// a ray grows with the distance it travels, after the first hit too. 0 for orthographic.
    pub fn spread(&self) -> f32 {
        if self.ortho {
            0.0
        } else {
            FOOTPRINT_SCALE * self.pixel / self.focal
        }
    }

    /// The width of the cone where a camera ray starts (0 for a perspective camera).
    pub fn start_width(&self) -> f32 {
        if self.ortho {
            FOOTPRINT_SCALE * self.pixel
        } else {
            0.0
        }
    }

    /// The footprint of the camera ray along `dir` (unit) at distance `t` on a surface of unit
    /// normal `n`: the ray differentials transferred to the hit and projected onto its plane.
    pub fn footprint(&self, dir: Vec3, t: f32, n: Vec3) -> Footprint {
        let (dpx, dpy) = if self.ortho {
            (self.right * self.pixel, self.up * self.pixel)
        } else {
            let along = dir.dot(self.forward);
            if along.is_nan() || along <= 1.0e-6 {
                return Footprint::cone(dir, self.spread() * t, n);
            }
            // The ray's point on the sensor plane at the focal length, and how the unit
            // direction changes when it moves by a pixel.
            let d = dir * (self.focal / along);
            let len = d.length();
            let ddir = |dd: Vec3| (dd - dir * dir.dot(dd)) * (t / len);
            (ddir(self.right * self.pixel), ddir(self.up * self.pixel))
        };
        let c = dir.dot(n);
        let c = if c.abs() < MIN_COS {
            if c < 0.0 {
                -MIN_COS
            } else {
                MIN_COS
            }
        } else {
            c
        };
        let onto = |dp: Vec3| (dp - dir * (dp.dot(n) / c)) * FOOTPRINT_SCALE;
        Footprint {
            dx: onto(dpx),
            dy: onto(dpy),
        }
    }
}

/// What the textures make of a material at a point.
#[derive(Clone, Debug, PartialEq)]
pub struct Textured {
    /// The material there.
    pub material: Material,
    /// The radiance the surface sends there: an emitter's whole radiance (its colour slot, its
    /// emission slot and its labels applied), or what an emission slot adds to any other
    /// material (black: nothing).
    pub emission: Rgb,
}

/// A slot ready to be read.
#[derive(Clone, Debug, PartialEq)]
struct Slot {
    image: Arc<TextureImage>,
    /// Index into the material's mappings.
    mapping: usize,
    wrap: u32,
    channel: u32,
    flags: u32,
    strength: f32,
    cutoff: f32,
}

/// A label ready to be read.
#[derive(Clone, Debug, PartialEq)]
struct PreparedLabel {
    image: Arc<TextureImage>,
    frame: LabelFrame,
    roughness: f32,
    coat: f32,
    relief: f32,
}

/// The textures of one material, prepared.
#[derive(Clone, Debug, PartialEq)]
struct Prepared {
    slots: [Option<Slot>; SLOTS],
    /// The distinct mappings of its slots (each for its image's proportions).
    mappings: Vec<Mapping>,
    labels: Vec<PreparedLabel>,
    emission_tint: Rgb,
}

impl Prepared {
    fn new(t: &MaterialTextures, images: &[Arc<TextureImage>]) -> Option<Prepared> {
        let mut mappings: Vec<Mapping> = Vec::new();
        let mut slots: [Option<Slot>; SLOTS] = Default::default();
        for (k, s) in t.slots.iter().enumerate() {
            let Some(image) = s.image.and_then(|i| images.get(i as usize)) else {
                continue;
            };
            let m = Mapping::new(s, image.aspect());
            let mapping = match mappings.iter().position(|x| *x == m) {
                Some(i) => i,
                None => {
                    mappings.push(m);
                    mappings.len() - 1
                }
            };
            slots[k] = Some(Slot {
                image: image.clone(),
                mapping,
                wrap: s.wrap,
                channel: s.channel,
                flags: s.flags,
                strength: s.strength,
                cutoff: s.cutoff,
            });
        }
        let labels: Vec<PreparedLabel> = t
            .labels
            .iter()
            .filter_map(|l| {
                let image = l.image.and_then(|i| images.get(i as usize))?;
                Some(PreparedLabel {
                    image: image.clone(),
                    frame: LabelFrame::new(l),
                    roughness: l.roughness,
                    coat: l.coat,
                    relief: l.relief,
                })
            })
            .collect();
        if slots.iter().all(Option::is_none) && labels.is_empty() {
            return None;
        }
        Some(Prepared {
            slots,
            mappings,
            labels,
            emission_tint: t.emission_tint,
        })
    }

    /// True when the textures change what shadow rays see through the material: its opacity
    /// (an alpha slot), or, through a thin wall, its tint and transmission (colour, labels).
    fn changes_shadows(&self) -> bool {
        self.slots[SLOT_ALPHA].is_some()
            || self.slots[SLOT_COLOR].is_some()
            || !self.labels.is_empty()
    }
}

/// The hit in the part's own space: the point, the outward interpolated normal, the UVs.
struct Local {
    p: Vec3,
    n: Vec3,
    uv: UvAt,
}

impl Local {
    fn of(geometry: &Geometry, details: &Hit) -> Option<Local> {
        let (mesh, _) = geometry.instance_mesh(details.instance)?;
        let tri = details.triangle as usize;
        let ids = mesh.triangle_indices(tri)?;
        let [p0, p1, p2] = mesh.triangle(tri)?;
        let [b0, b1, b2] = details.barycentrics;
        let p = p0 * b0 + p1 * b1 + p2 * b2;
        let winding = crate::geometry::edges::winding_normal(mesh, details.triangle);
        let n = match ids.map(|i| mesh.normal(i as usize)) {
            [Some(n0), Some(n1), Some(n2)] => {
                let n = n0 * b0 + n1 * b1 + n2 * b2;
                if n.length_squared() > 1.0e-24 {
                    n.normalize()
                } else {
                    winding
                }
            }
            _ => winding,
        };
        let mut uv = UvAt::default();
        let e1 = p1 - p0;
        let e2 = p2 - p0;
        let nt = e1.cross(e2);
        let area2 = nt.length_squared();
        let (gs, gt) = if area2 > 1.0e-30 {
            (e2.cross(nt) * (1.0 / area2), nt.cross(e1) * (1.0 / area2))
        } else {
            (Vec3::ZERO, Vec3::ZERO)
        };
        for set in 0..mesh.uv_sets().min(2) {
            let [Some(a), Some(b), Some(c)] = ids.map(|i| mesh.uv(set, i as usize)) else {
                continue;
            };
            uv.uv[set] = [
                (a[0] * b0 + b[0] * b1) + c[0] * b2,
                (a[1] * b0 + b[1] * b1) + c[1] * b2,
            ];
            uv.grad[set] = [
                gs * (b[0] - a[0]) + gt * (c[0] - a[0]),
                gs * (b[1] - a[1]) + gt * (c[1] - a[1]),
            ];
        }
        Some(Local { p, n, uv })
    }
}

/// The textures of every instance of a scene, prepared once per scene.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextureSetup {
    /// Per instance (particles have none).
    instances: Vec<Option<Arc<Prepared>>>,
    /// The camera's differentials.
    camera: CameraCone,
}

impl TextureSetup {
    /// The textures of every instance whose material has a texture block with an image.
    pub fn new(scene: &Scene) -> TextureSetup {
        let camera = CameraCone::new(scene);
        let per_material: Vec<Option<Arc<Prepared>>> = (0..scene.materials.len())
            .map(|i| {
                let t = scene.textures.get(i)?.as_ref()?;
                Prepared::new(t, &scene.images).map(Arc::new)
            })
            .collect();
        if per_material.iter().all(Option::is_none) {
            return TextureSetup {
                instances: Vec::new(),
                camera,
            };
        }
        let instances = scene
            .geometry
            .instances()
            .iter()
            .map(|inst| per_material.get(inst.material_id as usize)?.clone())
            .collect();
        TextureSetup { instances, camera }
    }

    /// True when no instance has textures.
    pub fn is_empty(&self) -> bool {
        self.instances.iter().all(Option::is_none)
    }

    /// The camera's ray differentials.
    pub fn camera(&self) -> &CameraCone {
        &self.camera
    }

    /// True when instance `i` has textures.
    pub fn has(&self, i: u32) -> bool {
        matches!(self.instances.get(i as usize), Some(Some(_)))
    }

    /// True when instance `i`'s opacity varies over its surface (an alpha slot): shadow rays
    /// may cross it.
    pub fn has_alpha(&self, i: u32) -> bool {
        matches!(self.instances.get(i as usize), Some(Some(p)) if p.slots[SLOT_ALPHA].is_some())
    }

    /// The textures at the hit `details` of `ray` on a surface of material `base`, with the
    /// footprint of the ray there: the material and the radiance it sends, and the shading normal
    /// of `shade` bent by the normal slot and the labels' edges. `None` (and `shade` untouched)
    /// for an instance without textures.
    pub fn apply(
        &self,
        scene: &Scene,
        ray: &Ray,
        details: &Hit,
        shade: &mut ShadingPoint,
        base: &Material,
        footprint: &Footprint,
    ) -> Option<Textured> {
        let tex = self.instances.get(details.instance as usize)?.as_ref()?;
        let geometry = &scene.geometry;
        let local = Local::of(geometry, details)?;
        let dx = geometry.vector_to_object(details.instance, footprint.dx);
        let dy = geometry.vector_to_object(details.instance, footprint.dy);
        // The shading normal in the part's space, on the outside of the surface.
        let ns = geometry
            .normal_to_object(details.instance, shade.normal)
            .normalize();
        let side = if ns.dot(local.n) < 0.0 { -1.0 } else { 1.0 };
        let mut normal = if ns.is_finite() && ns != Vec3::ZERO {
            ns * side
        } else {
            local.n
        };
        let mut bent = false;
        let out = evaluate(tex, &local, base, dx, dy, Some((&mut normal, &mut bent)));
        if bent {
            let n = geometry
                .normal_to_world(details.instance, normal * side)
                .normalize();
            let to_viewer = -ray.dir.normalize();
            let c = n.dot(to_viewer);
            let n = if c < MIN_FACING {
                (n + to_viewer * (MIN_FACING - c)).normalize()
            } else {
                n
            };
            if n.is_finite() && n != Vec3::ZERO {
                shade.normal = n;
            }
        }
        Some(out)
    }

    /// The material of a surface a shadow ray crosses (a cut-out, a thin wall) at the hit
    /// `details`, on level 0 and without relief: `None` when its textures change nothing a
    /// shadow ray sees (or it has none).
    pub fn at_shadow(&self, scene: &Scene, details: &Hit, base: &Material) -> Option<Material> {
        let tex = self.instances.get(details.instance as usize)?.as_ref()?;
        if !tex.changes_shadows() {
            return None;
        }
        let local = Local::of(&scene.geometry, details)?;
        Some(evaluate(tex, &local, base, Vec3::ZERO, Vec3::ZERO, None).material)
    }

    /// The base colour the textures give the hit `details` of the camera ray `ray` (the albedo
    /// pass), `None` without textures.
    pub fn albedo(&self, scene: &Scene, ray: &Ray, details: &Hit, base: &Material) -> Option<Rgb> {
        let tex = self.instances.get(details.instance as usize)?.as_ref()?;
        let geometry = &scene.geometry;
        let local = Local::of(geometry, details)?;
        let dir = ray.dir.normalize();
        let f = self
            .camera
            .footprint(dir, details.t * ray.dir.length(), details.geometric_normal);
        let dx = geometry.vector_to_object(details.instance, f.dx);
        let dy = geometry.vector_to_object(details.instance, f.dy);
        Some(
            evaluate(tex, &local, base, dx, dy, None)
                .material
                .base_color,
        )
    }
}

/// True when the emitted radiance of material `material` of `scene` varies over its surface
/// (an emitter with a colour or emission image, or labels): it is not sampled as a light by its
/// flux, only found by the rays that hit it.
pub fn emission_varies(scene: &Scene, material: u32) -> bool {
    let Some(Some(t)) = scene.textures.get(material as usize) else {
        return false;
    };
    let has = |i: Option<u32>| i.is_some_and(|i| (i as usize) < scene.images.len());
    has(t.slots[SLOT_COLOR].image)
        || has(t.slots[SLOT_EMISSION].image)
        || t.labels.iter().any(|l| has(l.image))
}

/// `a + t·(b − a)`.
#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + t * (b - a)
}

/// The level of detail of a read at `c` with the footprint `(dx, dy)` (part space).
#[inline]
fn lod_of(image: &TextureImage, du: Vec3, dv: Vec3, dx: Vec3, dy: Vec3) -> f32 {
    image.lod((du.dot(dx), dv.dot(dx)), (du.dot(dy), dv.dot(dy)))
}

/// A slot's texel at a point: the blend of its coordinates by their weights.
fn read(slot: &Slot, at: &Projected, dx: Vec3, dy: Vec3) -> [f32; 4] {
    let mut out = [0.0f32; 4];
    for c in at.used() {
        if c.weight <= 0.0 {
            continue;
        }
        let lod = lod_of(&slot.image, c.du, c.dv, dx, dy);
        let t = slot.image.sample(c.u, c.v, lod, slot.wrap);
        for k in 0..4 {
            out[k] += t[k] * c.weight;
        }
    }
    out
}

/// The scalar of a slot's texel: its channel, inverted if the slot says so.
#[inline]
fn scalar(slot: &Slot, texel: [f32; 4]) -> f32 {
    let v = TextureImage::channel_of(texel, slot.channel);
    if slot.flags & SLOT_FLAG_INVERT != 0 {
        1.0 - v
    } else {
        v
    }
}

/// `v` with its component along `n` removed.
#[inline]
fn tangential(v: Vec3, n: Vec3) -> Vec3 {
    v - n * n.dot(v)
}

/// A tangent-space normal `m` in the frame of the gradients `du`, `dv` around `n`.
fn bend(n: Vec3, du: Vec3, dv: Vec3, m: Vec3) -> Vec3 {
    let t = tangential(du, n);
    let b = tangential(dv, n);
    let longest = t.length_squared().max(b.length_squared()).max(1.0e-20);
    let s = 1.0 / longest.sqrt();
    ((t * (s * m.x) + b * (s * m.y)) + n * m.z).normalize()
}

/// The gradient (part space) of a scalar of a slot's image along `u` and `v` around `(u, v)`,
/// by central differences of one texel of the level `lod` reads, as surface gradient through
/// `du`, `dv`.
#[allow(clippy::too_many_arguments)]
fn height_gradient(
    image: &TextureImage,
    value: impl Fn([f32; 4]) -> f32,
    u: f32,
    v: f32,
    lod: f32,
    wrap: u32,
    du: Vec3,
    dv: Vec3,
) -> Vec3 {
    let level = if lod > 0.0 { lod.floor() as usize } else { 0 };
    let (w, h) = image
        .level_size(level)
        .or_else(|| image.level_size(image.level_count() - 1))
        .unwrap_or((1, 1));
    let (su, sv) = (1.0 / w as f32, 1.0 / h as f32);
    let at = |a: f32, b: f32| value(image.sample(a, b, lod, wrap));
    let dhu = (at(u + su, v) - at(u - su, v)) * (0.5 / su);
    let dhv = (at(u, v + sv) - at(u, v - sv)) * (0.5 / sv);
    du * dhu + dv * dhv
}

/// The textures `tex` at `local` on a material `base`, with the footprint `(dx, dy)` (part
/// space); with `relief`, also the outward shading normal bent by the normal slot and the labels'
/// edges (and whether it was).
fn evaluate(
    tex: &Prepared,
    local: &Local,
    base: &Material,
    dx: Vec3,
    dy: Vec3,
    relief: Option<(&mut Vec3, &mut bool)>,
) -> Textured {
    let mut m = base.clone();
    let emitter = base.is_emissive();
    let mut emission = if emitter { base.radiance() } else { Rgb::BLACK };
    // Each mapping is projected once, on first use.
    let mut projected: [Option<Projected>; SLOTS] = [None; SLOTS];
    let mut at = |k: usize| -> Projected {
        let i = k.min(SLOTS - 1);
        *projected[i].get_or_insert_with(|| tex.mappings[i].project(local.p, local.n, &local.uv))
    };
    if let Some(s) = &tex.slots[SLOT_COLOR] {
        let t = read(s, &at(s.mapping), dx, dy);
        let c = Rgb::new(t[0], t[1], t[2]);
        if emitter {
            emission = emission * c;
        } else {
            m.base_color = m.base_color * c;
        }
    }
    if let Some(s) = &tex.slots[SLOT_ROUGHNESS] {
        let t = read(s, &at(s.mapping), dx, dy);
        m.roughness *= scalar(s, t);
    }
    if let Some(s) = &tex.slots[SLOT_METAL] {
        let t = read(s, &at(s.mapping), dx, dy);
        m.metallic *= scalar(s, t);
    }
    if let Some(s) = &tex.slots[SLOT_ALPHA] {
        let t = read(s, &at(s.mapping), dx, dy);
        let a = scalar(s, t);
        if s.flags & SLOT_FLAG_CUTOUT != 0 {
            if a < s.cutoff {
                m.opacity = 0.0;
            }
        } else {
            m.opacity *= a;
        }
    }
    if let Some(s) = &tex.slots[SLOT_EMISSION] {
        let t = read(s, &at(s.mapping), dx, dy);
        emission += tex.emission_tint * Rgb::new(t[0], t[1], t[2]) * s.strength;
    }
    let mut relief = relief;
    if let (Some(s), Some((n, bent))) = (&tex.slots[SLOT_NORMAL], relief.as_mut()) {
        let p = at(s.mapping);
        let n0 = **n;
        let mut sum = Vec3::ZERO;
        for c in p.used() {
            if c.weight <= 0.0 {
                continue;
            }
            let lod = lod_of(&s.image, c.du, c.dv, dx, dy);
            let bent_c = if s.flags & SLOT_FLAG_HEIGHT != 0 {
                let k = s.strength;
                let g = height_gradient(
                    &s.image,
                    |t| scalar(s, t) * k,
                    c.u,
                    c.v,
                    lod,
                    s.wrap,
                    c.du,
                    c.dv,
                );
                (n0 - tangential(g, n0)).normalize()
            } else {
                let t = s.image.sample(c.u, c.v, lod, s.wrap);
                let m = Vec3::new(
                    (t[0] * 2.0 - 1.0) * s.strength,
                    (t[1] * 2.0 - 1.0) * s.strength,
                    t[2] * 2.0 - 1.0,
                );
                bend(n0, c.du, c.dv, m)
            };
            sum += bent_c * c.weight;
        }
        let out = sum.normalize();
        if out.is_finite() && out != Vec3::ZERO {
            **n = out;
            **bent = true;
        }
    }
    if !tex.labels.is_empty() {
        // Premultiplied, as each label goes over the ones before it: the coverage, the finish.
        let (mut cover, mut rough, mut coat) = (0.0f32, 0.0f32, 0.0f32);
        let mut edge = Vec3::ZERO;
        let mut any_edge = false;
        for l in &tex.labels {
            let f = &l.frame;
            let facing =
                (local.p - f.origin).dot(f.normal).abs() <= f.depth && local.n.dot(f.normal) > 0.0;
            if !facing {
                continue;
            }
            let (s, t) = f.coords(local.p);
            let lod = lod_of(&l.image, f.su, f.tv, dx, dy);
            let alpha = |s: f32, t: f32| -> f32 {
                if (0.0..=1.0).contains(&s) && (0.0..=1.0).contains(&t) {
                    l.image.sample(s, t, lod, WRAP_CLAMP)[3]
                } else {
                    0.0
                }
            };
            if (0.0..=1.0).contains(&s) && (0.0..=1.0).contains(&t) {
                let texel = l.image.sample(s, t, lod, WRAP_CLAMP);
                let a = texel[3];
                if a > 0.0 {
                    m.base_color = Rgb::new(
                        lerp(m.base_color.r, texel[0], a),
                        lerp(m.base_color.g, texel[1], a),
                        lerp(m.base_color.b, texel[2], a),
                    );
                    rough = lerp(rough, l.roughness, a);
                    coat = lerp(coat, l.coat, a);
                    cover += a * (1.0 - cover);
                }
            }
            // The paper's edge: the gradient of its alpha (its rectangle included), within a
            // texel of the label.
            if l.relief > 0.0 && relief.is_some() {
                let level = if lod > 0.0 { lod.floor() as usize } else { 0 };
                let (w, h) = l
                    .image
                    .level_size(level)
                    .or_else(|| l.image.level_size(l.image.level_count() - 1))
                    .unwrap_or((1, 1));
                let (ds, dt) = (1.0 / w as f32, 1.0 / h as f32);
                let near = s >= -ds && s <= 1.0 + ds && t >= -dt && t <= 1.0 + dt;
                if near {
                    let gs = (alpha(s + ds, t) - alpha(s - ds, t)) * (0.5 / ds);
                    let gt = (alpha(s, t + dt) - alpha(s, t - dt)) * (0.5 / dt);
                    let k = l.relief * LABEL_RELIEF_MM;
                    edge += (f.su * gs + f.tv * gt) * k;
                    any_edge = true;
                }
            }
        }
        if cover > 0.0 {
            let keep = 1.0 - cover;
            m.roughness = m.roughness * keep + rough;
            m.coat = m.coat * keep + coat;
            m.metallic *= keep;
            m.transmission *= keep;
            emission = emission * keep;
        }
        if let (true, Some((n, bent))) = (any_edge, relief.as_mut()) {
            let n0 = **n;
            let out = (n0 - tangential(edge, n0)).normalize();
            if out.is_finite() && out != Vec3::ZERO && edge != Vec3::ZERO {
                **n = out;
                **bent = true;
            }
        }
    }
    Textured {
        material: m,
        emission,
    }
}

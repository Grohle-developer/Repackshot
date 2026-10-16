//! Caustics: progressive photon mapping for the light that reaches a diffuse surface through
//! glass or off polished metal (E5b-1).
//!
//! **The method.** Stochastic progressive photon mapping (T. Hachisuka and H. W. Jensen,
//! "Stochastic Progressive Photon Mapping", *ACM TOG* 28(5), SIGGRAPH Asia 2009; after T.
//! Hachisuka, S. Ogaki and H. W. Jensen, "Progressive Photon Mapping", SIGGRAPH Asia 2008) in the
//! probabilistic form of C. Knaus and M. Zwicker ("Progressive Photon Mapping: A Probabilistic
//! Approach", *ACM TOG* 30(3), 2011): every sample index `i` of the image is one pass with its own
//! photons ([`PhotonMap::trace`]) and its own visible points (the camera paths of that sample),
//! and the estimate of the pass is a plain photon-map density estimate with the radius
//! `r_i² = r_1² Π_{k=1..i} (k + α) / (k + 1)`, `α = 2/3`. Averaging the passes, which is what
//! the film does with its samples, converges like SPPM, without any per-pixel state: a tile can
//! still be rendered by any thread, in any order, and give the same bits. The first radius is
//! `RNDR.caustic_radius` pixels of the image at the camera's target distance.
//!
//! **Which paths** (Heckbert's notation, with the surfaces split in two kinds). A *caster* is a
//! smooth specular surface ([`is_caster`]): glass or metal whose sharper lobe has a roughness of at
//! most [`MAX_ROUGHNESS`] (brushed metal counts along its brush), solid or thin. Everything else that scatters is a *receiver*, the floor
//! included. A *straight* event (a cut-out passed, a thin wall's straight transmission) is no
//! event at all for this split, on both sides. The photon map carries exactly the light of the
//! segments `L C+ R`: photons leave the lights that send them ([`crate::light::LightSample`]'s
//! `photon`: glossy area lights and suns, emissive meshes; never the environment, nor the point
//! lights and spots of L4, whose caustics stay with the path tracer), cross casters
//! only, and are stored on the first receiver they reach, which ends them. The camera gathers them
//! at every receiver its path reaches, the first one (`L C+ R C* E`, the caustic seen directly or
//! through glass) and any later one (`L C+ R … R E`, a caustic lighting the scene by a diffuse
//! bounce, clamped as indirect light). The path tracer leaves out exactly the same light: after
//! any receiver, a contribution of a photon light that arrives through casters only (BSDF-sampled
//! hits and next-event estimation at a caster) is dropped. Nothing is counted twice and nothing
//! is lost; `caustics/tests.rs` checks it against the path tracer alone. (Left to the path tracer,
//! the caustic seen through a diffuse bounce comes in rare, bright samples: sparkles that a
//! thousand samples do not smooth.) The path depth of `RNDR.max_depth` holds for both: a photon
//! that crossed `k` casters counts only at a visible point at depth `max_depth - 1 - k` or less.
//!
//! **Photons.** Emitted towards the bounding spheres of the casters (at most [`MAX_SPHERES`]; more
//! casters share one sphere): a light is chosen in proportion to the flux it sends at them, a
//! point uniformly on it, then a direction uniformly inside the cone of one sphere chosen by its
//! solid angle; the photon's flux divides by the density of the whole mixture (every cone that
//! contains the direction), so the estimate is unbiased: a direction that misses every sphere
//! cannot reach a caster first. A sun sends them along its direction (inside its disc) from discs
//! that cover the spheres. At a caster the photon samples the BSDF ([`Bsdf::sample`]) and
//! carries flux, not radiance: a refraction takes back the `1/η²` of radiance transport, and
//! shading normals get Veach's adjoint correction (E. Veach, PhD thesis, Stanford 1997, §5.3).
//! Absorption inside solids, cut-outs and thin walls behave as in the path tracer. The random
//! numbers are a PCG stream per (seed, sample index, photon index), so a map is the same bits
//! whoever traces it and however its photons are split ([`PhotonMap::trace_range`]).
//!
//! **The shadow catcher** (`FLOR.mode` 2, the interface's floor): photons land on its plane too,
//! and the camera ray that meets it adds their light, relative to the light the open floor gets
//! (`lit / open` is its shadow, `caustic / open` its caustics), to the background it shows: a
//! glass's shadow on it is lit by what crosses the glass. With a transparent background the
//! catcher's caustics are not shown (its alpha holds only the shadow).
//!
//! **Lookup.** A hashed uniform grid whose cell is the diameter of the pass's radius: a query
//! visits at most eight cells, in a fixed order, and the photons of a cell in the order they were
//! traced. The kernel is `2 (1 - d²/r²) / (π r²)` (it integrates to one over the disc), and a
//! photon counts only on a surface facing the same way as the visible point (geometric normals
//! within 60°) and with light from the side the BSDF sees.

use crate::bsdf::{Bsdf, Lobes};
use crate::color::Rgb;
use crate::fmath;
use crate::integrator::{beer_lambert, peak, BvhTracer, Prepared, Tracer};
use crate::light::{build_cdf, pick, Lights};
use crate::math::{offset_origin, Aabb, Frame, Ray, Vec3};
use crate::rng::{mix64, Pcg32};
use crate::scene::{Material, Scene, MATERIAL_GLASS};
use crate::simd::Isa;
use crate::warp;
use std::ops::Range;

/// `x > 0`, false for NaN.
#[inline]
fn positive(x: f32) -> bool {
    x > 0.0
}

/// Roughest glass or metal that still focuses light (and so sends its light by photons).
pub const MAX_ROUGHNESS: f32 = 0.25;
/// Most caster spheres photons are aimed at; with more casters, one sphere holds them all.
pub const MAX_SPHERES: usize = 16;
/// `α` of the radius sequence (Knaus and Zwicker 2011, the value they recommend).
pub const RADIUS_ALPHA: f32 = 2.0 / 3.0;
/// Most cut-outs a photon passes.
const MAX_PHOTON_CUTOUTS: u32 = 64;
/// Smallest geometric normal agreement between a photon and a visible point (cos 60°).
const SAME_SIDE: f32 = 0.5;
/// Millimetres to metres.
const MM_TO_M: f32 = 1.0e-3;
/// Square millimetres to square metres.
const MM2_TO_M2: f32 = 1.0e-6;

/// The roughness of the sharper direction of a material's GGX lobes: with anisotropy `a` the
/// lobe is `α s` wide across the tangent (`s = √(1 - 0.9 a)`, [`crate::bsdf`]), as sharp as a
/// roughness `r ⁴√(1 - 0.9 a)`.
pub fn sharpest_roughness(m: &Material) -> f32 {
    let a = m.anisotropy.clamp(0.0, 1.0);
    if a > 0.0 {
        m.roughness * (1.0 - 0.9 * a).sqrt().sqrt()
    } else {
        m.roughness
    }
}

/// True when a surface of material `m` focuses light: glass or metal whose sharper lobe
/// ([`sharpest_roughness`]: brushed metal focuses along its brush) has a roughness of at most
/// [`MAX_ROUGHNESS`] (thin walls included); the light it sends to a receiver comes by photons.
/// Emitters are never casters.
pub fn is_caster(m: &Material) -> bool {
    let r = sharpest_roughness(m);
    if m.is_emissive() || r.is_nan() || r > MAX_ROUGHNESS {
        return false;
    }
    // A scattering medium (E9b) is a receiver: photons land on it and none enter it.
    if crate::integrator::medium::of(m).is_some() {
        return false;
    }
    let glass = m.kind == MATERIAL_GLASS || (m.transmission >= 0.5 && m.metallic < 0.5);
    let metal = m.kind != MATERIAL_GLASS && m.metallic >= 0.5;
    glass || metal
}

/// One light that sends photons.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Source {
    Area(u32),
    Sun(u32),
    Mesh(u32),
}

/// What tracing caustic photons needs from a scene, computed once with [`Prepared`].
#[derive(Clone, Debug, PartialEq)]
pub struct CausticSetup {
    /// Photons traced per sample index.
    photons: u32,
    /// Gather radius of the first sample (mm).
    radius: f32,
    /// Bounding spheres (centre, radius) of the casters.
    spheres: Vec<(Vec3, f32)>,
    /// Per instance: a caster.
    casters: Vec<bool>,
    sources: Vec<Source>,
    /// Selection CDF of `sources`.
    cdf: Vec<f32>,
    /// The scene's bounding sphere, where sun photons start from.
    scene_centre: Vec3,
    scene_radius: f32,
    seed: u32,
    /// Most casters a photon crosses (`max_depth - 1`).
    max_bounces: u32,
}

/// Bounding sphere of a box.
fn sphere_of(b: &Aabb) -> (Vec3, f32) {
    (b.centroid(), (0.5 * (b.max - b.min).length()).max(1.0e-3))
}

/// World bounds of instance `i` (empty when its mesh is missing).
fn instance_bounds(scene: &Scene, i: usize) -> Aabb {
    let instances = scene.geometry.instances();
    let Some(inst) = instances.get(i) else {
        return Aabb::EMPTY;
    };
    let Some(mesh) = scene.geometry.meshes().get(inst.mesh as usize) else {
        return Aabb::EMPTY;
    };
    let b = mesh.bounds();
    if b.is_empty() {
        return b;
    }
    let mut out = Aabb::EMPTY;
    for k in 0..8u32 {
        let corner = Vec3::new(
            if k & 1 == 0 { b.min.x } else { b.max.x },
            if k & 2 == 0 { b.min.y } else { b.max.y },
            if k & 4 == 0 { b.min.z } else { b.max.z },
        );
        out = out.extend(inst.transform.point(corner));
    }
    out
}

/// A tight bounding sphere of instance `i`: the centre of its world box and the farthest of its
/// vertices from it.
fn instance_sphere(scene: &Scene, i: usize) -> (Vec3, f32) {
    let b = instance_bounds(scene, i);
    let centre = b.centroid();
    let inst = &scene.geometry.instances()[i];
    let Some(mesh) = scene.geometry.meshes().get(inst.mesh as usize) else {
        return sphere_of(&b);
    };
    let mut r2 = 0.0f32;
    for v in 0..mesh.vertex_count() {
        if let Some(p) = mesh.position(v) {
            r2 = r2.max((inst.transform.point(p) - centre).length_squared());
        }
    }
    // A hair wider than the farthest vertex, so the rounding of the cone test loses nothing.
    let r = r2.sqrt() * 1.0001 + 1.0e-3;
    if r > 0.0 && r.is_finite() {
        (centre, r)
    } else {
        sphere_of(&b)
    }
}

/// `1 - cos θ` of the cone a sphere of radius `r` at distance `d` (> r) subtends: `sin² / (1 +
/// cos)`, which keeps small cones exact.
#[inline]
fn cone_one_minus_cos(r: f32, d: f32) -> f32 {
    let sin2 = (r * r) / (d * d);
    let cos = (1.0 - sin2).max(0.0).sqrt();
    sin2 / (1.0 + cos)
}

/// The pixel footprint at the camera's target distance, in mm: what one pixel of the image
/// covers there.
fn pixel_footprint(scene: &Scene) -> f32 {
    let camera = &scene.camera;
    let (w, h) = (scene.render.width.max(1), scene.render.height.max(1));
    if camera.ortho {
        return camera.ortho_width.abs() / w as f32;
    }
    let distance = (camera.target - camera.position).length();
    distance * camera.sensor_mm / (camera.focal_mm.max(1.0e-3) * w.max(h) as f32)
}

impl CausticSetup {
    /// The caustics of `scene` with its prepared `lights`: `None` without photons
    /// (`RNDR.caustic_photons` 0), casters or lights that send photons.
    pub fn new(scene: &Scene, lights: &Lights) -> Option<CausticSetup> {
        let photons = scene.render.caustic_photons;
        if photons == 0 {
            return None;
        }
        let instances = scene.geometry.instances();
        let casters: Vec<bool> = instances
            .iter()
            .map(|inst| {
                scene
                    .materials
                    .get(inst.material_id as usize)
                    .is_some_and(is_caster)
            })
            .collect();
        let parts: Vec<usize> = (0..instances.len())
            .filter(|&i| casters[i] && !instance_bounds(scene, i).is_empty())
            .collect();
        if parts.is_empty() {
            return None;
        }
        let spheres: Vec<(Vec3, f32)> = if parts.len() > MAX_SPHERES {
            vec![sphere_of(&parts.iter().fold(Aabb::EMPTY, |acc, &i| {
                acc.union(instance_bounds(scene, i))
            }))]
        } else {
            parts.iter().map(|&i| instance_sphere(scene, i)).collect()
        };

        // The flux each light sends at the spheres (W), roughly: its selection weight.
        let towards = |x: Vec3, normal: Option<Vec3>| -> f32 {
            spheres
                .iter()
                .map(|&(c, r)| {
                    let d = c - x;
                    let dist = d.length();
                    let facing =
                        normal.map_or(1.0, |n| 0.05 + n.dot(d / dist.max(1.0e-6)).max(0.0));
                    let omega = if dist <= r {
                        fmath::PI
                    } else {
                        fmath::TAU * cone_one_minus_cos(r, dist)
                    };
                    omega * facing
                })
                .sum()
        };
        let mut sources = Vec::new();
        let mut weights = Vec::new();
        for (i, a) in lights.areas.iter().enumerate() {
            if !a.glossy {
                continue;
            }
            let w =
                a.radiance.luminance() * a.area * MM2_TO_M2 * towards(a.centre, Some(a.frame.z));
            if w > 0.0 && w.is_finite() {
                sources.push(Source::Area(i as u32));
                weights.push(w);
            }
        }
        for (i, s) in lights.suns.iter().enumerate() {
            if !s.glossy {
                continue;
            }
            let irradiance = if s.delta {
                s.radiance
            } else {
                s.radiance * (s.solid_angle * (1.0 - 0.5 * s.one_minus_cos_max))
            };
            let w = irradiance.luminance()
                * spheres
                    .iter()
                    .map(|&(_, r)| fmath::PI * r * r * MM2_TO_M2)
                    .sum::<f32>();
            if w > 0.0 && w.is_finite() {
                sources.push(Source::Sun(i as u32));
                weights.push(w);
            }
        }
        for (i, m) in lights.meshes.iter().enumerate() {
            let centroid = m.corners.iter().fold(Vec3::ZERO, |acc, c| {
                acc + (c[0] + c[1] + c[2]) * (1.0 / 3.0)
            }) * (1.0 / m.corners.len().max(1) as f32);
            let w = m.radiance.luminance() * m.area * MM2_TO_M2 * 0.5 * towards(centroid, None);
            if w > 0.0 && w.is_finite() {
                sources.push(Source::Mesh(i as u32));
                weights.push(w);
            }
        }
        let cdf = build_cdf(&weights);
        if cdf.is_empty() {
            return None;
        }
        let bounds = scene.bounds();
        let (scene_centre, scene_radius) = if bounds.is_empty() {
            (Vec3::ZERO, 1.0)
        } else {
            sphere_of(&bounds)
        };
        let radius_px = if scene.render.caustic_radius > 0.0 {
            scene.render.caustic_radius
        } else {
            crate::scene::RenderSettings::DEFAULT_CAUSTIC_RADIUS
        };
        let radius = (radius_px * pixel_footprint(scene)).max(1.0e-4);
        Some(CausticSetup {
            photons,
            radius,
            spheres,
            casters,
            sources,
            cdf,
            scene_centre,
            scene_radius,
            seed: scene.render.seed,
            max_bounces: scene.render.depth().saturating_sub(1),
        })
    }

    /// Photons traced per sample index.
    pub fn photons(&self) -> u32 {
        self.photons
    }

    /// True when instance `instance` is a caster.
    #[inline]
    pub fn is_caster_instance(&self, instance: u32) -> bool {
        self.casters
            .get(instance as usize)
            .copied()
            .unwrap_or(false)
    }

    /// The gather radius of sample index `iteration` (mm): the first radius, then shrinking by
    /// `(k + α) / (k + 1)` in area per pass (Knaus and Zwicker 2011).
    pub fn radius(&self, iteration: u32) -> f32 {
        let mut r2 = self.radius * self.radius;
        for k in 1..=iteration {
            r2 *= (k as f32 + RADIUS_ALPHA) / (k as f32 + 1.0);
        }
        r2.sqrt()
    }

    /// The random stream of photon `index` of pass `iteration`.
    fn rng(&self, iteration: u32, index: u32) -> Pcg32 {
        let key = (u64::from(self.seed) << 32) | u64::from(iteration);
        Pcg32::seeded(mix64(key ^ 0x0e5b_0001_c0de_cafe), u64::from(index))
    }

    /// Where photon `index` of pass `iteration` leaves its light, its direction and its flux
    /// (W). `None` when the sample sends nothing.
    fn emit(&self, lights: &Lights, rng: &mut Pcg32) -> Option<(Ray, Rgb)> {
        let n = self.photons as f32;
        let (j, _) = pick(&self.cdf, rng.next_f32());
        let p_light = self.cdf[j] - if j == 0 { 0.0 } else { self.cdf[j - 1] };
        if !positive(p_light) {
            return None;
        }
        let u_point = (rng.next_f32(), rng.next_f32());
        let u_pick = rng.next_f32();
        let u_dir = (rng.next_f32(), rng.next_f32());
        match self.sources[j] {
            Source::Area(a) => {
                let light = &lights.areas[a as usize];
                let x = light.sample_point(u_point);
                let one_sided = Some(light.frame.z);
                let (dir, pdf_dir) = self.sample_towards(x, one_sided, u_pick, u_dir)?;
                let cos = dir.dot(light.frame.z);
                if !positive(cos) {
                    return None;
                }
                let pdf_area = 1.0 / (light.area * MM2_TO_M2);
                let flux = light.radiance_at(cos) * (cos / (pdf_area * pdf_dir * p_light * n));
                Some((Ray::new(x, dir), flux))
            }
            Source::Mesh(m) => {
                let emitter = &lights.meshes[m as usize];
                let (t, rest) = pick(&emitter.cdf, u_point.0);
                let [a, b, c] = emitter.corners[t];
                let w = warp::uniform_triangle((rest, u_point.1));
                let x = a * w[0] + b * w[1] + c * w[2];
                let normal = emitter.normals[t];
                let one_sided = (!emitter.two_sided).then_some(normal);
                let (dir, pdf_dir) = self.sample_towards(x, one_sided, u_pick, u_dir)?;
                let facing = dir.dot(normal);
                if !emitter.two_sided && facing <= 0.0 {
                    return None;
                }
                let cos = facing.abs();
                if !positive(cos) {
                    return None;
                }
                let pdf_area = 1.0 / (emitter.area * MM2_TO_M2);
                let flux = emitter.radiance * (cos / (pdf_area * pdf_dir * p_light * n));
                let origin = offset_origin(x, if facing > 0.0 { normal } else { -normal });
                Some((Ray::new(origin, dir), flux))
            }
            Source::Sun(s) => {
                let sun = &lights.suns[s as usize];
                let to_sun = sun.frame.z;
                // The direction the light travels in (inside the disc for a sun with a size).
                let (travel, cos, pdf_dir) = if sun.delta {
                    (-to_sun, 1.0, 1.0)
                } else {
                    let local = warp::uniform_cone(u_dir, sun.one_minus_cos_max);
                    let d = sun.frame.to_world(local).normalize();
                    (-d, local.z, 1.0 / sun.solid_angle)
                };
                // Discs across the sun's direction, one over each sphere (a little wider for a
                // sun with a size, so tilted rays still find their sphere), on a plane beyond
                // the scene.
                let plane = self.scene_centre + to_sun * (2.0 * self.scene_radius);
                let tilt = if sun.delta {
                    0.0
                } else {
                    let s2 =
                        2.0 * sun.one_minus_cos_max - sun.one_minus_cos_max * sun.one_minus_cos_max;
                    s2.max(0.0).sqrt() * 4.0 * self.scene_radius
                };
                let areas: Vec<f32> = self
                    .spheres
                    .iter()
                    .map(|&(_, r)| fmath::PI * (r + tilt) * (r + tilt))
                    .collect();
                let cdf = build_cdf(&areas);
                if cdf.is_empty() {
                    return None;
                }
                let (k, _) = pick(&cdf, u_pick);
                let frame = Frame::from_normal(to_sun);
                let project = |c: Vec3| c - to_sun * (c - plane).dot(to_sun);
                let (dx, dy) = warp::concentric_disk(u_point);
                let (centre, r) = self.spheres[k];
                let rk = r + tilt;
                let x = project(centre) + frame.x * (dx * rk) + frame.y * (dy * rk);
                // Density over the plane: every disc that holds the point.
                let mut pdf_area = 0.0f32;
                for (i, &(c, r)) in self.spheres.iter().enumerate() {
                    let ri = r + tilt;
                    if (x - project(c)).length_squared() <= ri * ri {
                        let p = cdf[i] - if i == 0 { 0.0 } else { cdf[i - 1] };
                        pdf_area += p / (fmath::PI * ri * ri * MM2_TO_M2);
                    }
                }
                if !positive(pdf_area) {
                    return None;
                }
                let flux = sun.radiance * (cos / (pdf_area * pdf_dir * p_light * n));
                Some((Ray::new(x, travel), flux))
            }
        }
    }

    /// A direction from `x` towards the caster spheres and its density (per steradian) under
    /// the mixture of every sphere's cone; `normal` is the emitting side of a one-sided light.
    fn sample_towards(
        &self,
        x: Vec3,
        normal: Option<Vec3>,
        u_pick: f32,
        u: (f32, f32),
    ) -> Option<(Vec3, f32)> {
        // Each sphere: its direction, `1 - cos` of its cone (0 when x is inside it) and its
        // selection weight.
        let mut cones = [(Vec3::ZERO, 0.0f32, 0.0f32); MAX_SPHERES];
        let mut weights = [0.0f32; MAX_SPHERES];
        for (i, &(c, r)) in self.spheres.iter().enumerate() {
            let d = c - x;
            let dist = d.length();
            let axis = if dist > 0.0 {
                d / dist
            } else {
                Vec3::new(0.0, 0.0, 1.0)
            };
            let (omc, omega) = if dist <= r {
                (0.0, fmath::PI)
            } else {
                let omc = cone_one_minus_cos(r, dist);
                (omc, fmath::TAU * omc)
            };
            let facing = normal.map_or(1.0, |n| 0.05 + n.dot(axis).max(0.0));
            cones[i] = (axis, omc, 0.0);
            weights[i] = omega * facing;
        }
        let count = self.spheres.len();
        let cdf = build_cdf(&weights[..count]);
        if cdf.is_empty() {
            return None;
        }
        for i in 0..count {
            cones[i].2 = cdf[i] - if i == 0 { 0.0 } else { cdf[i - 1] };
        }
        let (k, _) = pick(&cdf, u_pick);
        let (axis, omc, _) = cones[k];
        let dir = if omc > 0.0 {
            Frame::from_normal(axis)
                .to_world(warp::uniform_cone(u, omc))
                .normalize()
        } else {
            // Inside the sphere: every direction may reach it.
            match normal {
                Some(n) => Frame::from_normal(n)
                    .to_world(warp::cosine_hemisphere(u))
                    .normalize(),
                None => warp::uniform_sphere(u),
            }
        };
        let mut pdf = 0.0f32;
        for &(axis, omc, p) in &cones[..count] {
            if !positive(p) {
                continue;
            }
            if omc > 0.0 {
                if 1.0 - dir.dot(axis) <= omc {
                    pdf += p / (fmath::TAU * omc);
                }
            } else {
                pdf += p * match normal {
                    Some(n) => dir.dot(n).max(0.0) * fmath::FRAC_1_PI,
                    None => 0.25 * fmath::FRAC_1_PI,
                };
            }
        }
        (pdf > 0.0 && pdf.is_finite()).then_some((dir, pdf))
    }
}

/// A photon stored on a receiver.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Photon {
    /// Where it landed.
    pub position: Vec3,
    /// Unit direction it came from (pointing away from the surface).
    pub wi: Vec3,
    /// The flux it carries (W).
    pub power: Rgb,
    /// Geometric normal of the receiver, on the side it arrived from.
    pub normal: Vec3,
    /// Casters it crossed (at least one).
    pub bounces: u32,
    /// It landed on the shadow catcher (`FLOR.mode` 2), which only camera rays see: only the
    /// catcher gathers it.
    pub catcher: bool,
}

/// Traces photon `index` of pass `iteration` and stores it in `out` if it reaches a receiver
/// through casters. Returns the rays cast.
fn trace_photon<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    setup: &CausticSetup,
    tracer: &T,
    iteration: u32,
    index: u32,
    out: &mut Vec<Photon>,
) -> u64 {
    let mut rng = setup.rng(iteration, index);
    let Some((mut ray, mut power)) = setup.emit(prepared.lights(), &mut rng) else {
        return 0;
    };
    if !(peak(power) > 0.0 && peak(power).is_finite()) {
        return 0;
    }
    let mut throughput = 1.0f32;
    let mut bounces = 0u32;
    let mut cutouts = 0u32;
    let mut medium: Option<Rgb> = None;
    let mut rays = 0u64;
    // The wavelength the photon carries since its first dispersive glass (E9c).
    let mut band: Option<crate::integrator::dispersion::Band> = None;
    // At most one event per crossing, cut-out or thin wall straight transmission included.
    for _ in 0..(setup.max_bounces + MAX_PHOTON_CUTOUTS + 64) {
        rays += 1;
        let hit = tracer.trace(&ray);
        let t_geometry = hit.map_or(f32::INFINITY, |h| h.t);
        // The floor, visible or a shadow catcher: photons land on both (only the camera sees the
        // catcher, and only it gathers what lands there).
        let t_floor = prepared.floor_t(&ray, true);
        let t_nearest = t_geometry.min(t_floor);
        if let Some(sigma) = medium {
            if t_nearest.is_finite() {
                power = power * beer_lambert(sigma, t_nearest);
            }
        }
        if t_nearest == f32::INFINITY {
            break;
        }
        if t_floor < t_geometry {
            if bounces > 0 {
                let p = ray.at(t_floor);
                out.push(Photon {
                    position: Vec3::new(p.x, p.y, prepared.floor_z),
                    wi: -ray.dir,
                    power,
                    normal: Vec3::new(0.0, 0.0, if ray.dir.z < 0.0 { 1.0 } else { -1.0 }),
                    bounces,
                    catcher: prepared.floor_mode == crate::scene::FloorMode::ShadowCatcher,
                });
            }
            break;
        }
        let Some(details) = hit.and_then(|h| scene.geometry.hit_details(&ray, h)) else {
            break;
        };
        let m = prepared.material(scene, details.instance);
        if m.is_emissive() {
            break;
        }
        let ng = details.geometric_normal;
        if m.opacity < 1.0 && cutouts < MAX_PHOTON_CUTOUTS {
            cutouts += 1;
            if rng.next_f32() >= m.opacity.max(0.0) {
                ray = Ray::new(offset_origin(details.point, -ng), ray.dir);
                continue;
            }
        }
        let caster = setup.is_caster_instance(details.instance);
        let bsdf = if crate::integrator::dispersion::is_dispersive(m) {
            let b = match band {
                Some(b) => b,
                None => {
                    let b = crate::integrator::dispersion::Band::choose(rng.next_f32());
                    power = b.mask(power);
                    band = Some(b);
                    b
                }
            };
            Bsdf::surface_at(m, details.outside, b.index(m))
        } else {
            Bsdf::surface(m, details.outside)
        };
        if !caster {
            if bounces > 0 {
                out.push(Photon {
                    position: details.point,
                    wi: -ray.dir,
                    power,
                    normal: ng,
                    bounces,
                    catcher: false,
                });
            }
            // A receiver ends the photon, unless it goes straight through a thin wall.
            if !bsdf.is_thin() {
                break;
            }
        } else if bounces >= setup.max_bounces {
            break;
        }
        // The shading normal, terminator point and edge bevel the camera paths use.
        let shade = prepared.bevel.shading_point(scene, &ray, &details);
        let (point, normal, ng) = (shade.point, shade.normal, shade.geometric);
        let frame = prepared.frame(Some(details.instance), point, normal);
        let wo_world = -ray.dir;
        let wo = frame.to_local(wo_world);
        let Some(bs) = bsdf.sample(wo, (rng.next_f32(), rng.next_f32())) else {
            break;
        };
        if !caster && !bs.straight {
            break;
        }
        let transmitted = bs.wi.z < 0.0;
        let wi = if bs.straight {
            ray.dir
        } else {
            frame.to_world(bs.wi).normalize()
        };
        if transmitted {
            if wi.dot(ng) >= 0.0 {
                break;
            }
        } else if wi.dot(ng) <= 0.0 {
            break;
        }
        let mut weight = bs.weight;
        if !bs.straight {
            if transmitted {
                // Flux, not radiance: no 1/η² across the interface.
                let eta = bsdf.eta();
                weight = weight * (eta * eta);
            }
            // Shading normals are not symmetric (Veach 1997, eq. 5.19).
            let num = wo_world.dot(normal).abs() * wi.dot(ng).abs();
            let den = wo_world.dot(ng).abs() * wi.dot(normal).abs();
            if den > 0.0 {
                weight = weight * (num / den).min(10.0);
            }
            bounces += 1;
        }
        power = power * weight;
        let step = peak(weight);
        throughput *= step;
        if bounces >= 3 {
            let survive = throughput.clamp(0.05, 1.0);
            if rng.next_f32() >= survive {
                break;
            }
            power = power * (1.0 / survive);
            throughput /= survive;
        }
        if !(peak(power) > 0.0 && peak(power).is_finite()) {
            break;
        }
        let next_origin = if transmitted || bs.straight {
            offset_origin(details.point, -ng)
        } else {
            offset_origin(point, ng)
        };
        if transmitted && !bs.straight {
            medium = if details.outside {
                scene
                    .geometry
                    .instances()
                    .get(details.instance as usize)
                    .and_then(|inst| prepared.media.get(inst.material_id as usize))
                    .copied()
                    .flatten()
            } else {
                None
            };
        }
        ray = Ray::new(next_origin, wi);
    }
    rays
}

/// The photons of one pass and their lookup grid.
#[derive(Clone, Debug, PartialEq)]
pub struct PhotonMap {
    iteration: u32,
    /// Gather radius (mm).
    radius: f32,
    /// `1 / r²`.
    inv_r2: f32,
    /// Kernel normalisation `2 / (π r²)`, with the radius in metres.
    norm: f32,
    /// Grid cell edge (the diameter) and its inverse.
    inv_cell: f32,
    photons: Vec<Photon>,
    /// Photon indices sorted by bucket, and where each bucket starts.
    order: Vec<u32>,
    starts: Vec<u32>,
    mask: u32,
    /// Rays cast to trace it.
    rays: u64,
}

/// The cell of a point.
#[inline]
fn cell_of(p: Vec3, inv_cell: f32) -> (i32, i32, i32) {
    let c = |v: f32| -> i32 {
        let f = (v * inv_cell).floor();
        if f.is_finite() {
            f.clamp(-1.0e9, 1.0e9) as i32
        } else {
            0
        }
    };
    (c(p.x), c(p.y), c(p.z))
}

/// The bucket of a cell.
#[inline]
fn bucket_of(cell: (i32, i32, i32), mask: u32) -> u32 {
    let h = (cell.0 as u32).wrapping_mul(73_856_093)
        ^ (cell.1 as u32).wrapping_mul(19_349_663)
        ^ (cell.2 as u32).wrapping_mul(83_492_791);
    h & mask
}

impl PhotonMap {
    /// Traces every photon of pass `iteration` of a scene with caustics (an empty map without).
    pub fn trace(scene: &Scene, prepared: &Prepared, iteration: u32, isa: Isa) -> PhotonMap {
        let count = prepared.caustics.as_ref().map_or(0, |s| s.photons);
        let (photons, rays) = PhotonMap::trace_range(scene, prepared, iteration, 0..count, isa);
        PhotonMap::build(prepared, iteration, photons, rays)
    }

    /// Traces photons `range` of pass `iteration` (the stored ones, in index order, and the
    /// rays cast). Hosts split a pass among threads and concatenate the parts in range order
    /// for [`PhotonMap::build`]: the map is the same bits however it was split.
    pub fn trace_range(
        scene: &Scene,
        prepared: &Prepared,
        iteration: u32,
        range: Range<u32>,
        isa: Isa,
    ) -> (Vec<Photon>, u64) {
        let Some(setup) = prepared.caustics.as_ref() else {
            return (Vec::new(), 0);
        };
        let tracer = BvhTracer {
            geometry: &scene.geometry,
            isa,
        };
        let mut out = Vec::new();
        let mut rays = 0u64;
        for index in range.start..range.end.min(setup.photons) {
            rays += trace_photon(scene, prepared, setup, &tracer, iteration, index, &mut out);
        }
        (out, rays)
    }

    /// The map of pass `iteration` from its photons in index order.
    pub fn build(
        prepared: &Prepared,
        iteration: u32,
        photons: Vec<Photon>,
        rays: u64,
    ) -> PhotonMap {
        let radius = prepared
            .caustics
            .as_ref()
            .map_or(1.0, |s| s.radius(iteration));
        let r_m = radius * MM_TO_M;
        let inv_cell = 1.0 / (2.0 * radius);
        let buckets = (photons.len().max(1) * 2).next_power_of_two().min(1 << 24) as u32;
        let mask = buckets - 1;
        let keys: Vec<u32> = photons
            .iter()
            .map(|p| bucket_of(cell_of(p.position, inv_cell), mask))
            .collect();
        let mut starts = vec![0u32; buckets as usize + 1];
        for &k in &keys {
            starts[k as usize + 1] += 1;
        }
        for i in 0..buckets as usize {
            starts[i + 1] += starts[i];
        }
        let mut fill = starts.clone();
        let mut order = vec![0u32; photons.len()];
        for (i, &k) in keys.iter().enumerate() {
            order[fill[k as usize] as usize] = i as u32;
            fill[k as usize] += 1;
        }
        PhotonMap {
            iteration,
            radius,
            inv_r2: 1.0 / (radius * radius),
            norm: 2.0 / (fmath::PI * r_m * r_m),
            inv_cell,
            photons,
            order,
            starts,
            mask,
            rays,
        }
    }

    /// The sample index this map belongs to.
    pub fn iteration(&self) -> u32 {
        self.iteration
    }

    /// Its gather radius (mm).
    pub fn radius(&self) -> f32 {
        self.radius
    }

    /// The stored photons, in the order they were traced.
    pub fn photons(&self) -> &[Photon] {
        &self.photons
    }

    /// Number of stored photons.
    pub fn len(&self) -> usize {
        self.photons.len()
    }

    /// True when no photon was stored.
    pub fn is_empty(&self) -> bool {
        self.photons.is_empty()
    }

    /// Rays cast to trace it.
    pub fn rays(&self) -> u64 {
        self.rays
    }

    /// The radiance the photons around `point` send towards the camera: the sum, over the
    /// photons within the radius on a surface facing `normal` that crossed at most
    /// `max_bounces` casters (those on the shadow catcher when `catcher`, the others otherwise),
    /// of `f(wi) × power × kernel`, `f` being the BSDF of the visible point for the photon's
    /// direction (world space).
    pub fn gather(
        &self,
        point: Vec3,
        normal: Vec3,
        max_bounces: u32,
        catcher: bool,
        mut f: impl FnMut(Vec3) -> Rgb,
    ) -> Rgb {
        let mut sum = Rgb::BLACK;
        if self.photons.is_empty() {
            return sum;
        }
        let r = self.radius;
        let lo = cell_of(point - Vec3::splat(r), self.inv_cell);
        let hi = cell_of(point + Vec3::splat(r), self.inv_cell);
        for cz in lo.2..=hi.2.min(lo.2 + 1) {
            for cy in lo.1..=hi.1.min(lo.1 + 1) {
                for cx in lo.0..=hi.0.min(lo.0 + 1) {
                    let cell = (cx, cy, cz);
                    let b = bucket_of(cell, self.mask) as usize;
                    let (from, to) = (self.starts[b] as usize, self.starts[b + 1] as usize);
                    for &i in &self.order[from..to] {
                        let p = &self.photons[i as usize];
                        if p.bounces > max_bounces
                            || p.catcher != catcher
                            || p.normal.dot(normal) < SAME_SIDE
                        {
                            continue;
                        }
                        let d2 = (p.position - point).length_squared() * self.inv_r2;
                        if d2 >= 1.0 || cell_of(p.position, self.inv_cell) != cell {
                            continue;
                        }
                        let k = self.norm * (1.0 - d2);
                        let fv = f(p.wi);
                        if peak(fv) > 0.0 {
                            sum += fv * p.power * k;
                        }
                    }
                }
            }
        }
        sum
    }
}

/// The BSDF and frame of a visible point, and the radiance its photons send along `wo`: what
/// the integrator adds at every receiver a camera path reaches.
pub(crate) fn gather_at(
    map: &PhotonMap,
    bsdf: &Bsdf,
    frame: &Frame,
    wo: Vec3,
    point: Vec3,
    geometric: Vec3,
    max_bounces: u32,
) -> Rgb {
    map.gather(point, geometric, max_bounces, false, |wi| {
        bsdf.eval(wo, frame.to_local(wi), Lobes::All)
    })
}

/// The radiance a white Lambertian shadow catcher at `point` (normal `n`, facing the camera)
/// reflects of its photons: what the catcher adds to the light it shows ([`crate::integrator`]).
pub(crate) fn gather_catcher(map: &PhotonMap, point: Vec3, n: Vec3, max_bounces: u32) -> Rgb {
    map.gather(point, n, max_bounces, true, |wi| {
        if wi.dot(n) > 0.0 {
            Rgb::splat(fmath::FRAC_1_PI)
        } else {
            Rgb::BLACK
        }
    })
}

#[cfg(test)]
mod tests;

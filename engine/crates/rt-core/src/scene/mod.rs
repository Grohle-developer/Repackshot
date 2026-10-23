//! The in-memory scene and its binary interchange format ([`rsb`]).
//!
//! Units are millimetres for distances and degrees for angles. The world is Z-up.

#[cfg(test)]
mod camera_tests;
pub mod rsb;
#[cfg(test)]
mod section_rsb_tests;

pub use crate::bitmap::Bitmap;
use crate::color::Rgb;
use crate::math::{Aabb, Ray, Vec3};
pub use crate::optics::{Lens, LensParams};

pub use crate::geometry::{
    Geometry, GeometryError, Hit, Instance, Mesh, MeshError, ParticleSet, PixelFootprint, RayHit,
    SectionPlane, Solid, Transform, CAP_TRIANGLE, INSTANCE_NO_CAMERA, INSTANCE_NO_SECTION,
    INSTANCE_ONE_SIDED,
};
pub use crate::texture::{MaterialTextures, TextureImage};
pub use rsb::RsbError;
pub use rt_sim::AmbientParams;
use std::sync::Arc;

/// The particle sets of `effects` for `footprint`: a set of `kept` with the same parameters is
/// reused (its BVH built again only for another footprint), any other effect is evaluated. Each
/// set knows whether its material (of `materials`) is clear (S4b).
pub(crate) fn particle_sets(
    effects: &[AmbientParams],
    kept: Vec<ParticleSet>,
    footprint: PixelFootprint,
    width: crate::geometry::BvhWidth,
    materials: &[Material],
) -> Vec<ParticleSet> {
    let mut kept: Vec<Option<ParticleSet>> = kept.into_iter().map(Some).collect();
    effects
        .iter()
        .map(|params| {
            let reuse = kept
                .iter_mut()
                .find(|k| k.as_ref().is_some_and(|set| set.params() == params))
                .and_then(Option::take);
            match reuse {
                Some(set) => set.with_footprint(footprint, width),
                None => ParticleSet::evaluate(params, footprint, width),
            }
            .with_material(materials.get(params.material_id as usize))
        })
        .collect()
}

/// How a camera maps its image onto directions (`CAMR.projection`, K3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Projection {
    /// 0, the default (and what a file without the field means): the camera of `CAMR.ortho_flag`,
    /// a perspective through the thin lens (or the traced lens of `LENS`), or orthographic.
    #[default]
    Standard,
    /// 1: an equirectangular panorama around the camera: the longitude runs across the image's
    /// width, the latitude across its height ([`Camera::fov_x_deg`], [`Camera::fov_y_deg`]).
    Equirectangular,
    /// 2: an equidistant fisheye: the angle from the view axis is proportional to the distance from
    /// the centre of the image ([`Camera::fov_x_deg`] across its width, square pixels).
    Fisheye,
}

impl Projection {
    /// Decodes the RSB value: 1 equirectangular, 2 fisheye, anything else (0, and values a newer
    /// writer may add) the standard camera.
    pub fn from_u32(value: u32) -> Projection {
        match value {
            1 => Projection::Equirectangular,
            2 => Projection::Fisheye,
            _ => Projection::Standard,
        }
    }

    /// The RSB value of this projection.
    pub fn to_u32(self) -> u32 {
        match self {
            Projection::Standard => 0,
            Projection::Equirectangular => 1,
            Projection::Fisheye => 2,
        }
    }
}

/// A camera: thin lens perspective or orthographic, or (K3) a panorama: equirectangular or a
/// fisheye.
#[derive(Clone, Debug, PartialEq)]
pub struct Camera {
    /// Position of the lens centre.
    pub position: Vec3,
    /// Point the camera looks at.
    pub target: Vec3,
    /// Approximate up direction (does not need to be orthogonal to the view direction).
    pub up: Vec3,
    /// Focal length in millimetres.
    pub focal_mm: f32,
    /// Sensor size in millimetres along the *longer* side of the image.
    pub sensor_mm: f32,
    /// Aperture as an f-number. Zero or less means a pinhole (no depth of field).
    pub fstop: f32,
    /// Distance from the lens to the plane of perfect focus, in scene units.
    pub focus_dist: f32,
    /// True for an orthographic projection.
    pub ortho: bool,
    /// Width of the orthographic view in scene units (used when `ortho` is true).
    pub ortho_width: f32,
    /// The optics beyond the plain thin lens (the `LENS` section, [`crate::optics`]); `None` is
    /// the plain thin lens. An orthographic or panoramic camera ignores it.
    pub lens: Option<Lens>,
    /// K3: how the image maps onto directions. A panoramic camera (not [`Projection::Standard`])
    /// is a pinhole at `position` looking along the basis of `target` and `up`; it ignores
    /// `ortho`, the focal length, the sensor, the aperture and the lens.
    pub projection: Projection,
    /// K3, panoramic cameras: the field across the image's width, degrees. Equirectangular: the
    /// longitude it spans (360: the whole turn; a viewport image that is wider than the output
    /// frame spans more, and wraps). Fisheye: the angle from the left edge to the right edge through
    /// the centre (the angle from the axis is `fov_x_deg / width` per pixel of distance from the
    /// centre; beyond 180° from the axis a sample sees nothing).
    pub fov_x_deg: f32,
    /// K3, equirectangular: the latitude the image's height spans, degrees (180: pole to pole; past
    /// a pole the rays go on over it). The fisheye does not read it (its pixels are square).
    pub fov_y_deg: f32,
    /// K3: the factor of what camera rays see of the environment, the background when it is the
    /// environment: a camera ray that escapes, also through cut-outs and thin walls (the window of a
    /// room), brings `exterior` times the environment's radiance; nothing else changes, so the
    /// window darkens and the room it lights does not. 1: no change.
    pub exterior: f32,
}

impl Default for Camera {
    fn default() -> Camera {
        Camera {
            position: Vec3::new(0.0, -1000.0, 0.0),
            target: Vec3::ZERO,
            up: Vec3::new(0.0, 0.0, 1.0),
            focal_mm: 50.0,
            sensor_mm: 36.0,
            fstop: 0.0,
            focus_dist: 1000.0,
            ortho: false,
            ortho_width: 1000.0,
            lens: None,
            projection: Projection::Standard,
            fov_x_deg: 360.0,
            fov_y_deg: 180.0,
            exterior: 1.0,
        }
    }
}

impl Camera {
    /// Orthonormal camera basis `(forward, right, up)`. Degenerate input (target equal to the
    /// position, or `up` parallel to the view direction) falls back to a valid basis.
    pub fn basis(&self) -> (Vec3, Vec3, Vec3) {
        let mut forward = (self.target - self.position).normalize();
        if forward.length_squared() == 0.0 {
            forward = Vec3::new(0.0, 1.0, 0.0);
        }
        let mut right = forward.cross(self.up).normalize();
        if right.length_squared() < 0.5 {
            // `up` is zero or parallel to `forward`: pick any axis that is not.
            let axis = if forward.z.abs() < 0.9 {
                Vec3::new(0.0, 0.0, 1.0)
            } else {
                Vec3::new(1.0, 0.0, 0.0)
            };
            right = forward.cross(axis).normalize();
        }
        let up = right.cross(forward);
        (forward, right, up)
    }

    /// K3: true for a panoramic camera (equirectangular or fisheye).
    pub fn panoramic(&self) -> bool {
        self.projection != Projection::Standard
    }

    /// True when the camera's rays go through its lens: a perspective camera of the standard
    /// projection (not orthographic, not panoramic). Only then do the aperture, the `LENS` optics and
    /// its filters apply.
    pub fn through_lens(&self) -> bool {
        !self.ortho && !self.panoramic()
    }

    /// K3: the direction of a panoramic camera through the image point `(u, v)` (as in
    /// [`Camera::generate_ray`]), unit length up to rounding; `None` where a fisheye sees nothing
    /// (more than 180° from its axis) and for the standard projection. Equirectangular: longitude
    /// `(u − ½)·fov_x` from the view axis towards the right, latitude `(½ − v)·fov_y` towards `up`;
    /// fisheye: the angle `θ = √(x² + y²)` from the axis for `x = (u − ½)·fov_x` and
    /// `y = (½ − v)·fov_x / aspect`, turned towards `(x, y)`. Only `+ − × ÷ sqrt` and
    /// [`crate::fmath`]: the same bits on every platform.
    pub fn panorama_dir(&self, aspect: f32, u: f32, v: f32) -> Option<Vec3> {
        let (forward, right, up) = self.basis();
        match self.projection {
            Projection::Standard => None,
            Projection::Equirectangular => {
                let lon = (u - 0.5) * (self.fov_x_deg * crate::fmath::DEG_TO_RAD);
                let lat = (0.5 - v) * (self.fov_y_deg * crate::fmath::DEG_TO_RAD);
                let (s_lat, c_lat) = crate::fmath::sin_cos(lat);
                let (s_lon, c_lon) = crate::fmath::sin_cos(lon);
                Some(forward * (c_lat * c_lon) + right * (c_lat * s_lon) + up * s_lat)
            }
            Projection::Fisheye => {
                let k = self.fov_x_deg * crate::fmath::DEG_TO_RAD;
                let x = (u - 0.5) * k;
                let y = (0.5 - v) * k / aspect.max(1.0e-6);
                let theta = (x * x + y * y).sqrt();
                if theta.is_nan() || theta > crate::fmath::PI {
                    return None;
                }
                if theta == 0.0 {
                    return Some(forward);
                }
                let (s, c) = crate::fmath::sin_cos(theta);
                Some(forward * c + (right * x + up * y) * (s / theta))
            }
        }
    }

    /// K3: the ray of a panoramic camera through `(u, v)`: from `position` along
    /// [`Camera::panorama_dir`]; where a fisheye sees nothing, a ray along the axis that can meet
    /// nothing (its interval is empty) — [`Camera::sample_ray`] weighs it black.
    fn panorama_ray(&self, aspect: f32, u: f32, v: f32) -> Ray {
        match self.panorama_dir(aspect, u, v) {
            Some(dir) => Ray::new(self.position, dir),
            None => Ray {
                t_max: 0.0,
                ..Ray::new(self.position, self.basis().0)
            },
        }
    }

    /// What a traced lens is prepared for: the optics of this camera, not its placement (O2).
    pub fn optics_key(&self) -> crate::optics::traced::CameraOptics {
        crate::optics::traced::CameraOptics {
            focal_mm: self.focal_mm,
            fstop: self.fstop,
            focus_dist: self.focus_dist,
            sensor_mm: self.sensor_mm,
        }
    }

    /// Prepares the camera's traced lens (O2) for its optics: scaled to `focal_mm`, focused at
    /// `focus_dist`, the stop for `fstop`, the pupil bounds for `sensor_mm`. Nothing for the thin
    /// lens or when it is already prepared for these values; every host that changes those four
    /// fields of a camera with a traced lens calls it again (the RSB reader does).
    pub fn prepare_lens(&mut self) -> Result<(), &'static str> {
        let key = self.optics_key();
        let through = self.through_lens();
        match &mut self.lens {
            Some(lens) if through => lens.prepare(key),
            _ => Ok(()),
        }
    }

    /// O2: what the engine computed of the camera's traced lens, as JSON
    /// ([`crate::optics::traced::LensInfo::to_json`]: focal length, back focus, f-number, T-stop,
    /// transmittance, distortion and relative illumination against image height), or
    /// `{"traced":false}` for the thin lens or an orthographic or panoramic camera. The hosts (`rt_wasm`, the
    /// launcher's `/api/lens/info`) hand it to the interface, which shows these numbers and never
    /// its own (rule 10).
    pub fn lens_info_json(&self) -> String {
        match self
            .lens
            .as_ref()
            .and_then(|l| l.traced())
            .filter(|_| self.through_lens())
        {
            Some(traced) => traced.info().to_json(),
            None => "{\"traced\":false}".to_string(),
        }
    }

    /// Radius of the lens aperture in scene units, zero for a pinhole (and an orthographic or
    /// panoramic camera).
    pub fn lens_radius(&self) -> f32 {
        if self.fstop > 0.0 && self.focus_dist > 0.0 && self.through_lens() {
            self.focal_mm / self.fstop * 0.5
        } else {
            0.0
        }
    }

    /// Generates the camera ray through the image point `(u, v)`.
    ///
    /// `u` runs left to right and `v` top to bottom, both in `[0, 1]`. `aspect` is
    /// `width / height`. `lens` is a point in the unit disk used to sample the aperture; it is
    /// ignored for a pinhole, orthographic or panoramic camera. The returned direction is
    /// normalised (a panoramic one up to rounding).
    pub fn generate_ray(&self, aspect: f32, u: f32, v: f32, lens: (f32, f32)) -> Ray {
        if self.panoramic() {
            return self.panorama_ray(aspect, u, v);
        }
        if let (Some(optics), false) = (&self.lens, self.ortho) {
            return optics.thin_ray(self, aspect, u, v, lens);
        }
        let (forward, right, up) = self.basis();
        if self.ortho {
            let w = self.ortho_width;
            let origin = self.position + right * ((u - 0.5) * w) + up * ((0.5 - v) * w / aspect);
            return Ray::new(origin, forward);
        }
        // The sensor size applies to the longer image side.
        let (sensor_w, sensor_h) = if aspect >= 1.0 {
            (self.sensor_mm, self.sensor_mm / aspect)
        } else {
            (self.sensor_mm * aspect, self.sensor_mm)
        };
        let x = (u - 0.5) * sensor_w;
        let y = (0.5 - v) * sensor_h;
        let dir = (forward * self.focal_mm + right * x + up * y).normalize();
        let radius = self.lens_radius();
        if radius == 0.0 {
            return Ray::new(self.position, dir);
        }
        // Rays through the lens centre hit the focus plane at `focus_dist` along the axis.
        let focus_point = self.position + dir * (self.focus_dist / dir.dot(forward));
        let origin = self.position + (right * lens.0 + up * lens.1) * radius;
        Ray::new(origin, (focus_point - origin).normalize())
    }

    /// One camera sample through the image point `(u, v)` (as in [`Camera::generate_ray`]) with
    /// the lens numbers of `sampler`: the ray, and the colour weight of the light it brings back.
    /// The plain thin lens takes a point of the unit disk (the concentric map of the lens
    /// dimensions) and weighs white; a [`Lens`] draws its own pupil and may weigh a band or block
    /// the sample ([`Lens::sample`]).
    pub fn sample_ray(
        &self,
        aspect: f32,
        u: f32,
        v: f32,
        sampler: &crate::sampler::PixelSampler,
    ) -> (Ray, Rgb) {
        if self.panoramic() {
            // K3: a pinhole; a fisheye's sample beyond 180° from its axis brings nothing.
            let ray = self.panorama_ray(aspect, u, v);
            let weight = if ray.t_max > 0.0 {
                Rgb::WHITE
            } else {
                Rgb::BLACK
            };
            return (ray, weight);
        }
        if let (Some(optics), false) = (&self.lens, self.ortho) {
            return optics.sample(self, aspect, u, v, sampler);
        }
        let lens = if self.lens_radius() > 0.0 {
            crate::warp::concentric_disk(sampler.get2(crate::sampler::DIM_LENS))
        } else {
            (0.0, 0.0)
        };
        (self.generate_ray(aspect, u, v, lens), Rgb::WHITE)
    }
}

/// `MATL.kind` 0: the principled surface (Lambert diffuse, GGX specular, metal, transmission,
/// clear coat).
pub const MATERIAL_PRINCIPLED: u32 = 0;
/// `MATL.kind` 1: glass: the principled surface without its metal (a dielectric whose
/// `transmission` says how much of it is clear).
pub const MATERIAL_GLASS: u32 = 1;
/// `MATL.kind` 2: an emitter of radiance `emission * emission_power` that reflects nothing.
pub const MATERIAL_EMISSIVE: u32 = 2;
/// `MATL.flags` bit 0: an emissive material is also sampled explicitly (next-event estimation)
/// as an area light. Without it the emitter is only found by rays that happen to hit it.
pub const MATERIAL_FLAG_LIGHT: u32 = 1;
/// `MATL.flags` bit 1: the transmissive part is a thin wall (a sheet with no inside): light goes
/// straight through it without refraction, so it also lets shadow rays through.
pub const MATERIAL_FLAG_THIN: u32 = 2;

/// A surface material. See the [`rsb`] module documentation for the meaning of every field.
#[derive(Clone, Debug, PartialEq)]
pub struct Material {
    /// Material model: [`MATERIAL_PRINCIPLED`], [`MATERIAL_GLASS`] or [`MATERIAL_EMISSIVE`].
    /// Unknown values render as principled (newer files keep working).
    pub kind: u32,
    /// Diffuse or metal colour in linear RGB (the tint of glass).
    pub base_color: Rgb,
    /// 0 = dielectric, 1 = metal.
    pub metallic: f32,
    /// Perceptual roughness in `[0, 1]`; the GGX width is its square.
    pub roughness: f32,
    /// Index of refraction of the dielectric (sets the specular reflectance at normal incidence).
    pub ior: f32,
    /// Share of the dielectric that is clear (refracting) instead of diffuse, in `[0, 1]`.
    pub transmission: f32,
    /// Clear coat strength in `[0, 1]`.
    pub coat: f32,
    /// Clear coat roughness in `[0, 1]`.
    pub coat_roughness: f32,
    /// Emitted colour in linear RGB (kind [`MATERIAL_EMISSIVE`]).
    pub emission: Rgb,
    /// Emission multiplier: the radiance is `emission * emission_power`, in W / (sr m^2).
    pub emission_power: f32,
    /// Bit set of `MATERIAL_FLAG_*` values.
    pub flags: u32,
    /// Coverage in `[0, 1]`: below one the surface is a stochastic cut-out, rays pass through it
    /// with probability `1 - opacity` (and shadow rays are attenuated by that).
    pub opacity: f32,
    /// Anisotropy of the GGX lobes in `[0, 1]` (0: isotropic), along a tangent running around
    /// the instance's local Z axis.
    pub anisotropy: f32,
    /// Absorption distance of the clear part, in millimetres: `base_color` is what is left of
    /// white light after travelling this far inside (Beer–Lambert). 0: no absorption, the colour
    /// tints the surface instead (once per pass through a solid, or through a thin wall).
    pub absorption_mm: f32,
    /// Radius of the edge bevel in millimetres (E6, [`crate::bevel`]): the shading normal is
    /// rounded within this distance of the mesh's sharp edges, as if they were filleted. 0 (or
    /// less): sharp edges.
    pub bevel_mm: f32,
    /// Mean free path, in millimetres, of the scattering medium that fills a clear solid of this
    /// material (E9b, [`crate::integrator::medium`]); 0: none.
    pub scatter_mm: f32,
    /// Single-scattering albedo of that medium, per channel (what each event keeps).
    pub scatter_color: Rgb,
    /// Henyey–Greenstein anisotropy of that medium, clamped to ±0.9 (positive: forwards).
    pub scatter_g: f32,
    /// Abbe number of a solid clear material (E9c, `integrator::dispersion`): its index
    /// changes with the wavelength; 0: no dispersion.
    pub abbe: f32,
}

impl Default for Material {
    fn default() -> Material {
        Material {
            kind: MATERIAL_PRINCIPLED,
            base_color: Rgb::splat(0.8),
            metallic: 0.0,
            roughness: 0.5,
            ior: 1.5,
            transmission: 0.0,
            coat: 0.0,
            coat_roughness: 0.0,
            emission: Rgb::BLACK,
            emission_power: 0.0,
            flags: 0,
            opacity: 1.0,
            anisotropy: 0.0,
            absorption_mm: 0.0,
            bevel_mm: 0.0,
            scatter_mm: 0.0,
            scatter_color: Rgb::WHITE,
            scatter_g: 0.0,
            abbe: 0.0,
        }
    }
}

impl Material {
    /// True for an emitter (kind [`MATERIAL_EMISSIVE`]).
    pub fn is_emissive(&self) -> bool {
        self.kind == MATERIAL_EMISSIVE
    }

    /// Emitted radiance (zero unless the material is an emitter).
    pub fn radiance(&self) -> Rgb {
        if self.is_emissive() {
            (self.emission * self.emission_power).map(|v| v.max(0.0))
        } else {
            Rgb::BLACK
        }
    }
}

/// Shape of a light source (`LGHT.kind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LightKind {
    /// 0: a rectangle of `size_x x size_y`, emitting along `direction`.
    Rect,
    /// 1: a disk of diameter `size_x`, emitting along `direction`.
    Disk,
    /// 2: a distant sun of angular diameter `angle_deg`; light travels along `direction`.
    Sun,
    /// 3: a point light (L4): a sphere of diameter `size_x` (0: a point) glowing the same in every
    /// direction.
    Point,
    /// 4: a spot light (L4): the point light it would be, inside a cone of `spread_deg` about
    /// `direction` with a soft edge of `angle_deg` inward from the cone's edge.
    Spot,
    /// 5: an IES light (L5): the point light it would be, with the intensity of the photometric
    /// profile [`Light::ies`] in each direction (`direction` is the profile's axis, `up` the
    /// direction of its horizontal angle 0), as bright at its peak as the point light of `power`.
    Ies,
}

impl LightKind {
    /// Decodes the RSB value (0 rect, 1 disk, 2 sun, 3 point, 4 spot, 5 IES).
    pub fn from_u32(value: u32) -> Option<LightKind> {
        match value {
            0 => Some(LightKind::Rect),
            1 => Some(LightKind::Disk),
            2 => Some(LightKind::Sun),
            3 => Some(LightKind::Point),
            4 => Some(LightKind::Spot),
            5 => Some(LightKind::Ies),
            _ => None,
        }
    }

    /// The RSB value of this kind.
    pub fn to_u32(self) -> u32 {
        match self {
            LightKind::Rect => 0,
            LightKind::Disk => 1,
            LightKind::Sun => 2,
            LightKind::Point => 3,
            LightKind::Spot => 4,
            LightKind::Ies => 5,
        }
    }
}

/// Light flag (bit 0): the light is seen by BSDF-sampled rays (reflections) and lights every
/// lobe. Without it the light only lights the diffuse lobe, through explicit sampling, and is
/// invisible in reflections (like Blender's "glossy" ray visibility).
pub const LIGHT_FLAG_GLOSSY: u32 = 1;
/// Light flag (bit 1): the light is directly visible to camera rays.
pub const LIGHT_FLAG_CAMERA: u32 = 2;
/// Light flag (bit 2, L4): the light casts no shadow (its shadow rays are not traced). Files from
/// before it never set the bit: every light casts shadows.
pub const LIGHT_FLAG_NO_SHADOW: u32 = 4;

/// A light source.
#[derive(Clone, Debug, PartialEq)]
pub struct Light {
    /// Shape of the light.
    pub kind: LightKind,
    /// Centre of the light.
    pub position: Vec3,
    /// Direction in which the light travels (from the light into the scene).
    pub direction: Vec3,
    /// Orientation of the light's local Y axis around `direction`.
    pub up: Vec3,
    /// Width (rect) or diameter (disk, point, spot, IES), in scene units.
    pub size_x: f32,
    /// Height (rect), in scene units.
    pub size_y: f32,
    /// Emitted colour in linear RGB.
    pub color: Rgb,
    /// Rect and disk: radiant flux in watts leaving the front face without spread falloff
    /// (scene millimetres are read as 1e-3 m, so the radiance is `power / (π · area_m2)`). Sun:
    /// irradiance in W/m^2 on a surface facing it. Point: flux in watts sent the same in every
    /// direction (intensity `power / 4π` W/sr). Spot: the flux of the point light it masks (its
    /// axis is as bright as that point light, whatever its cone). IES: the flux of the point light
    /// whose intensity is the profile's peak candela (the profile gives the shape, `power` the
    /// level: a bright direction of the profile is as bright as that point light and no brighter).
    pub power: f32,
    /// Rect and disk: beam spread in degrees: 180 is a bare diffuser (Lambertian); smaller values
    /// add a `cos^n` falloff whose intensity halves at `spread_deg / 2` from the normal. Spot: the
    /// full angle of its cone.
    pub spread_deg: f32,
    /// Sun: angular diameter in degrees. Spot: the soft edge, degrees inward from the edge of the
    /// cone (a smoothstep from 0 at the edge to 1).
    pub angle_deg: f32,
    /// Bit set of `LIGHT_FLAG_*` values.
    pub flags: u32,
    /// IES: the photometric profile whose candela give the light's intensity in each direction
    /// (L5, the `IESP` section the light refers to). `None` for every other kind; an IES light
    /// without one is ignored.
    pub ies: Option<Arc<crate::ies::IesProfile>>,
}

impl Default for Light {
    fn default() -> Light {
        Light {
            kind: LightKind::Rect,
            position: Vec3::new(0.0, 0.0, 1000.0),
            direction: Vec3::new(0.0, 0.0, -1.0),
            up: Vec3::new(0.0, 1.0, 0.0),
            size_x: 500.0,
            size_y: 500.0,
            color: Rgb::WHITE,
            power: 1.0,
            spread_deg: 180.0,
            angle_deg: 0.5,
            flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
            ies: None,
        }
    }
}

/// Kind of environment lighting (`ENVR.kind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnvKind {
    /// 0: procedural studio dome, a grey ramp over the elevation of the viewing direction from
    /// `floor` (straight down) through `horizon` to `zenith` (straight up).
    Studio,
    /// 1: a single flat colour of brightness `horizon`.
    Flat,
    /// 2: the procedural daylight sky of [`crate::sky`], its sun at `sun_azimuth_deg` and
    /// `sun_elevation_deg`, scaled to light like the dome of the same values.
    Sky,
    /// 3: the equirectangular HDRI image `hdri_map`, turned by `rotation_deg`, times `strength`
    /// (the dome when the bitmap is missing).
    Hdri,
}

impl EnvKind {
    /// Decodes the RSB value (0 studio, 1 flat, 2 sky, 3 HDRI).
    pub fn from_u32(value: u32) -> Option<EnvKind> {
        match value {
            0 => Some(EnvKind::Studio),
            1 => Some(EnvKind::Flat),
            2 => Some(EnvKind::Sky),
            3 => Some(EnvKind::Hdri),
            _ => None,
        }
    }

    /// The RSB value of this kind.
    pub fn to_u32(self) -> u32 {
        match self {
            EnvKind::Studio => 0,
            EnvKind::Flat => 1,
            EnvKind::Sky => 2,
            EnvKind::Hdri => 3,
        }
    }
}

/// The daylight model of the sky (`ENVR.sky_model`, E5c).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum SkyModel {
    /// 0, the default (and what a file without the field means): the physical sky of
    /// [`crate::sky::PhysicalSky`], fitted to our own atmosphere simulation.
    #[default]
    Physical,
    /// 1: the classic sky of Preetham, Shirley and Smits ([`crate::sky::Preetham`]).
    Classic,
}

impl SkyModel {
    /// Decodes the RSB value: 1 classic, anything else (0, and values a newer writer may add)
    /// the physical sky.
    pub fn from_u32(value: u32) -> SkyModel {
        match value {
            1 => SkyModel::Classic,
            _ => SkyModel::Physical,
        }
    }

    /// The RSB value of this model.
    pub fn to_u32(self) -> u32 {
        match self {
            SkyModel::Physical => 0,
            SkyModel::Classic => 1,
        }
    }
}

/// `ENVR.background_mode` 0: camera rays that escape see the environment.
pub const BACKGROUND_ENVIRONMENT: u32 = 0;
/// `ENVR.background_mode` 1: camera rays that escape see `background_color`.
pub const BACKGROUND_COLOR: u32 = 1;
/// `ENVR.background_mode` 2: camera rays that escape see nothing; the film's alpha is 0 there.
pub const BACKGROUND_TRANSPARENT: u32 = 2;
/// `ENVR.background_mode` 3: a background image (`backplate_map`), seen by camera rays only and
/// fitted to the frame by `backplate_fit`; without the bitmap it is [`BACKGROUND_COLOR`].
pub const BACKGROUND_BACKPLATE: u32 = 3;

/// `ENVR.hdri_map` and `ENVR.backplate_map` when there is no bitmap.
pub const NO_BITMAP: u32 = u32::MAX;
/// `ENVR.backplate_fit` 0: the image covers the frame, cropped to keep its proportions.
pub const BACKPLATE_FILL: u32 = 0;
/// `ENVR.backplate_fit` 1: the whole image inside the frame, the rest `background_color`.
pub const BACKPLATE_FIT: u32 = 1;
/// `ENVR.backplate_fit` 2: the image stretched to the frame.
pub const BACKPLATE_STRETCH: u32 = 2;

/// What camera rays that escape the scene see. Decoded from `ENVR.background_mode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Background {
    /// The environment itself (and a sun disc marked visible to the camera).
    Environment,
    /// A flat colour.
    Color,
    /// Nothing: black with alpha 0.
    Transparent,
    /// The background image.
    Backplate,
}

/// The environment surrounding the scene.
#[derive(Clone, Debug, PartialEq)]
pub struct Environment {
    /// Kind of environment.
    pub kind: EnvKind,
    /// Brightness looking down.
    pub floor: f32,
    /// Brightness at the horizon.
    pub horizon: f32,
    /// Brightness looking up.
    pub zenith: f32,
    /// Global multiplier.
    pub strength: f32,
    /// Rotation around the vertical axis, degrees.
    pub rotation_deg: f32,
    /// Colour of the backdrop when it is not the environment itself.
    pub background_color: Rgb,
    /// What escaping camera rays see: `BACKGROUND_*` (unknown values mean the environment).
    pub background_mode: u32,
    /// Bitmap of the HDRI (kind [`EnvKind::Hdri`]), or [`NO_BITMAP`].
    pub hdri_map: u32,
    /// Bitmap of the background image ([`BACKGROUND_BACKPLATE`]), or [`NO_BITMAP`].
    pub backplate_map: u32,
    /// How the background image fits the frame: `BACKPLATE_*`.
    pub backplate_fit: u32,
    /// Turbidity of the sky (kind [`EnvKind::Sky`]): 2 very clear, 3 clear, 6 hazy.
    pub sky_turbidity: f32,
    /// The sky's daylight model (E5c).
    pub sky_model: SkyModel,
    /// Azimuth of the sky's sun in degrees, from +X towards +Y.
    pub sun_azimuth_deg: f32,
    /// Elevation of the sky's sun above the horizon in degrees.
    pub sun_elevation_deg: f32,
    /// Where the output frame lies in the rendered image, `[u0, v0, u1, v1]` (`u` left to
    /// right, `v` top to bottom): the background image is fitted to it. `[0, 0, 1, 1]` unless
    /// the image is a viewport larger than the frame.
    pub backplate_rect: [f32; 4],
}

impl Environment {
    /// The background mode, decoded (unknown values mean the environment). A backplate whose
    /// bitmap is missing is decided by the renderer, which falls back to the colour.
    pub fn background(&self) -> Background {
        match self.background_mode {
            BACKGROUND_COLOR => Background::Color,
            BACKGROUND_BACKPLATE => Background::Backplate,
            BACKGROUND_TRANSPARENT => Background::Transparent,
            _ => Background::Environment,
        }
    }
}

impl Default for Environment {
    fn default() -> Environment {
        Environment {
            kind: EnvKind::Studio,
            floor: 0.1,
            horizon: 0.3,
            zenith: 0.6,
            strength: 1.0,
            rotation_deg: 0.0,
            background_color: Rgb::splat(0.05),
            background_mode: 0,
            hdri_map: NO_BITMAP,
            backplate_map: NO_BITMAP,
            backplate_fit: BACKPLATE_FILL,
            sky_turbidity: crate::sky::DEFAULT_TURBIDITY,
            sky_model: SkyModel::Physical,
            sun_azimuth_deg: 0.0,
            sun_elevation_deg: 45.0,
            backplate_rect: [0.0, 0.0, 1.0, 1.0],
        }
    }
}

/// What the optional ground plane does (`FLOR.mode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FloorMode {
    /// 0: no floor.
    None,
    /// 1: an infinite diffuse plane at `z`, seen by every ray and casting shadows.
    Visible,
    /// 2: shadow catcher: invisible except for the shadows and occlusion it receives, which
    /// darken the background behind it (or, with a transparent background, become alpha).
    ShadowCatcher,
}

impl FloorMode {
    /// Decodes the RSB value (0 none, 1 visible, 2 shadow catcher).
    pub fn from_u32(value: u32) -> Option<FloorMode> {
        match value {
            0 => Some(FloorMode::None),
            1 => Some(FloorMode::Visible),
            2 => Some(FloorMode::ShadowCatcher),
            _ => None,
        }
    }

    /// The RSB value of this mode.
    pub fn to_u32(self) -> u32 {
        match self {
            FloorMode::None => 0,
            FloorMode::Visible => 1,
            FloorMode::ShadowCatcher => 2,
        }
    }
}

/// The ground plane of the studio: an infinite horizontal plane, Lambertian.
#[derive(Clone, Debug, PartialEq)]
pub struct Floor {
    /// What the floor does.
    pub mode: FloorMode,
    /// Height of the plane.
    pub z: f32,
    /// Diffuse albedo in linear RGB.
    pub color: Rgb,
}

impl Default for Floor {
    fn default() -> Floor {
        Floor {
            mode: FloorMode::None,
            z: 0.0,
            color: Rgb::splat(0.5),
        }
    }
}

/// Image size and sampling budget.
#[derive(Clone, Debug, PartialEq)]
pub struct RenderSettings {
    /// Image width in pixels (1..=[`RenderSettings::MAX_DIMENSION`]).
    pub width: u32,
    /// Image height in pixels (1..=[`RenderSettings::MAX_DIMENSION`]).
    pub height: u32,
    /// Sample budget per pixel (0 = unspecified, the host decides).
    pub max_samples: u32,
    /// Seed of the deterministic random streams.
    pub seed: u32,
    /// Time budget in seconds (0 = unlimited). Enforced by the host, never by `rt-core`.
    pub max_seconds: f32,
    /// Exposure compensation in stops, applied when converting to 8 bit.
    pub exposure_ev: f32,
    /// Tone mapping operator: 0 linear, 1 ACES, 2 filmic, 3 AgX, 4 standard (see
    /// [`crate::color::Tonemap`]).
    pub tonemap: u32,
    /// Largest number of surface interactions of a path (0 means the default, 8).
    pub max_depth: u32,
    /// Largest value of any colour channel of one indirect contribution (light that bounced
    /// at least twice before reaching the camera); 0 disables the clamp.
    pub clamp_indirect: f32,
    /// The exact passes to write next to the image (AI-POST.md §7.4): bit `i` is pass `i` of
    /// [`crate::passes::PASS_KEYS`]; 0 for none. Bits the engine does not know are kept and
    /// ignored (a newer writer may ask for passes added later).
    pub passes: u32,
    /// What the host does with the finished image (E5b-1, `rt_post::denoise`): bit 0
    /// ([`DENOISE_IMAGE`]) hands out the denoised image, bit 1 ([`DENOISE_KEEP_NOISY`]) the one
    /// without denoise as well. `rt-core` never reads it: rendering is the same with or without
    /// it. Unknown bits are kept and ignored.
    pub denoise: u32,
    /// Caustics (E5b-1, [`crate::caustics`]): photons traced from the lights per sample index
    /// (0: none; at most [`RenderSettings::MAX_CAUSTIC_PHOTONS`]). With photons the light that
    /// reaches a diffuse surface through glass or polished metal comes from the photon map and
    /// not from the paths of the tracer, which then leave it out.
    pub caustic_photons: u32,
    /// The gather radius of the first sample, in pixels of the image at the camera's focus
    /// distance (0: [`RenderSettings::DEFAULT_CAUSTIC_RADIUS`]); it shrinks with every sample.
    pub caustic_radius: f32,
    /// U11b: how much of the denoised image a host hands out, `0..=1`: `noisy × (1 − s) +
    /// denoised × s` per channel in linear light (`rt_post::denoise::blend`); 0 runs no filter,
    /// 1 (the default, and a file without it) is the filter's image.
    pub denoise_strength: f32,
    /// E11, `RNDR.pixel_filter`: where the camera samples go in and around their pixel
    /// ([`crate::pixel_filter`]: 0 the box of one pixel, the default; 1 the centre; 2 a tent of
    /// two pixels; 3 Blackman–Harris of three; unknown values are the box).
    pub pixel_filter: u32,
    /// E11, `RNDR.edge_supersample`: the samples an edge pixel takes per sample index (1: none
    /// more; 0 is read as 1; at most [`crate::pixel_filter::MAX_EDGE_SUPERSAMPLE`]).
    pub edge_supersample: u32,
    /// E10, `RNDR.adaptive`: bit 0 ([`crate::adaptive::ADAPTIVE_ON`]) the host samples
    /// adaptively, in rounds decided by the image's noise ([`crate::adaptive`]); 0, and a file
    /// without it, samples every pixel alike, as before. Unknown bits are kept and ignored.
    pub adaptive: u32,
    /// E10, `RNDR.noise_threshold`: with adaptive sampling, the relative error of the mean under
    /// which a block needs no more samples, `0..=1` (0.01 is 1 %); 0, none: the render ends by its
    /// samples or its time.
    pub noise_threshold: f32,
}

/// `RNDR.denoise` bit 0: the host denoises the finished image.
pub const DENOISE_IMAGE: u32 = 1;
/// `RNDR.denoise` bit 1: the host also keeps the image without denoise.
pub const DENOISE_KEEP_NOISY: u32 = 2;

impl RenderSettings {
    /// Largest accepted image width or height.
    pub const MAX_DIMENSION: u32 = 16_384;
    /// Path depth used when `max_depth` is 0.
    pub const DEFAULT_MAX_DEPTH: u32 = 8;
    /// Largest path depth the renderer honours.
    pub const MAX_DEPTH_LIMIT: u32 = 1024;
    /// Most caustic photons per sample index.
    pub const MAX_CAUSTIC_PHOTONS: u32 = 1 << 22;
    /// Gather radius of the first sample, in pixels, when `caustic_radius` is 0.
    pub const DEFAULT_CAUSTIC_RADIUS: f32 = 3.0;

    /// The samples an edge pixel takes per sample index ([`Self::edge_supersample`], 0 read as 1).
    pub fn edge_factor(&self) -> u32 {
        self.edge_supersample
            .clamp(1, crate::pixel_filter::MAX_EDGE_SUPERSAMPLE)
    }

    /// The path depth to render with: `max_depth`, or the default for 0, at most
    /// [`RenderSettings::MAX_DEPTH_LIMIT`].
    pub fn depth(&self) -> u32 {
        if self.max_depth == 0 {
            RenderSettings::DEFAULT_MAX_DEPTH
        } else {
            self.max_depth.min(RenderSettings::MAX_DEPTH_LIMIT)
        }
    }
}

impl Default for RenderSettings {
    fn default() -> RenderSettings {
        RenderSettings {
            width: 640,
            height: 360,
            max_samples: 64,
            seed: 0,
            max_seconds: 0.0,
            exposure_ev: 0.0,
            tonemap: 1,
            max_depth: RenderSettings::DEFAULT_MAX_DEPTH,
            clamp_indirect: 0.0,
            passes: 0,
            denoise: 0,
            caustic_photons: 0,
            caustic_radius: 0.0,
            denoise_strength: 1.0,
            pixel_filter: 0,
            edge_supersample: 1,
            adaptive: 0,
            noise_threshold: 0.0,
        }
    }
}

/// Everything needed to render an image.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scene {
    /// The camera.
    pub camera: Camera,
    /// Materials, referenced by [`Instance::material_id`] (and [`Mesh::material_id`]).
    pub materials: Vec<Material>,
    /// Meshes, instances and their acceleration structures.
    pub geometry: Geometry,
    /// Light sources.
    pub lights: Vec<Light>,
    /// Environment lighting.
    pub environment: Environment,
    /// The ground plane.
    pub floor: Floor,
    /// Image size and sampling settings.
    pub render: RenderSettings,
    /// Images the environment refers to (HDRI, background plate), by index.
    pub bitmaps: Vec<Bitmap>,
    /// Procedural patterns of the materials (E6, `PATN`: wood), at most one per material (the
    /// first counts).
    pub patterns: Vec<crate::pattern::Pattern>,
    /// The ambient effects (S4a, `FXAM`), in file order. Their particles live in the geometry
    /// ([`Geometry::particle_sets`], built by [`Scene::build_particles`]).
    pub effects: Vec<AmbientParams>,
    /// The section view (Q1, `SECT`): a plane that removes one side of the model and caps the
    /// cut. It lives in the geometry too, which every query asks ([`Scene::apply_section`] puts it
    /// there; the RSB reader and [`Scene::build_particles`] do).
    pub section: Option<SectionPlane>,
    /// The texture images (M2b, `IMGS`), by index, with their mipmaps.
    pub images: Vec<Arc<TextureImage>>,
    /// The texture block of each material (M2b, `MATL` from byte 100), by material index; a
    /// material past the end of the list has none.
    pub textures: Vec<Option<MaterialTextures>>,
    /// The material program of each material (M3b, `PROG`), by material index; a material past
    /// the end of the list has none.
    pub programs: Vec<Option<Arc<crate::program::Program>>>,
    /// The front glass (S3, `GLAS`): drops and dust on a pane in front of the camera, laid out for
    /// the camera ([`Scene::prepare_glass`] after the camera changes; the RSB reader does it).
    pub glass: Option<crate::optics::glass::FrontGlass>,
    /// The meshes carry their UV sets in the file although it has no images and no texture
    /// block (M2b). The writer gives every mesh its UV sets when this is set or when the scene has
    /// images or texture blocks, as the page's writer does when the scene carries textures.
    pub textured: bool,
    /// S3c: the rain, dust and snow on the instances (`WETP`, [`crate::weather`]), at most one per
    /// instance. Set them with [`Scene::set_wet_parts`] (the RSB reader does), which meshes their
    /// drops.
    pub wet_parts: Vec<crate::weather::PartWeather>,
    /// S3d: the drops in the air (`WETF`, [`crate::weather::FallingDrop`]), meshed as spheres after
    /// the caps. Set them with [`Scene::set_wet_falling`] (the RSB reader does).
    pub wet_falling: Vec<crate::weather::FallingDrop>,
    /// S3c: where the mesh of the drops' caps, its instance and its material (water) are, after the
    /// file's own: none without drops.
    pub caps: Option<Caps>,
    /// S3d: the instance each cap lies on, then the instance each drop in the air left, in the
    /// order of the caps' mesh ([`Scene::pass_instance`]).
    pub cap_owners: Vec<u32>,
    /// S3e: the rain, dust and snow on the studio floor (`WETG`, [`crate::weather::FloorWeather`]),
    /// which the floor of `FLOR` shades; none.
    pub wet_floor: Option<crate::weather::FloorWeather>,
    /// S3e: where the mesh of the dust's motes, its instance and its material (dust) are, after the
    /// caps': none without motes.
    pub motes: Option<Caps>,
    /// S3e: the instance each mote lies on, in the order of their mesh.
    pub mote_owners: Vec<u32>,
    /// S7: the nested-dielectric priority of each material (`NEST`,
    /// [`crate::integrator::nested`]), by material index; a material past the end of the list has
    /// priority 0. A scene where none is above 0 is traced as before, bit for bit.
    pub priorities: Vec<u32>,
}

/// S3c: the mesh of the drops' caps, its instance and its material, each the last of its list
/// (after the file's own, [`Scene::wet_parts`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Caps {
    /// Index of the mesh among the geometry's meshes.
    pub mesh: u32,
    /// Index of the instance.
    pub instance: u32,
    /// Index of the material (water).
    pub material: u32,
    /// S3d: how many caps the mesh holds first (the drops in the air come after them).
    pub caps: u32,
    /// S3f: the triangles of each cap ([`crate::weather::cap_triangles`]: more when the drops have
    /// shapes).
    pub cap_triangles: u32,
}

impl Scene {
    /// The pixel footprint of the scene's camera and image (the particles' minimum size).
    pub fn pixel_footprint(&self) -> PixelFootprint {
        PixelFootprint::of(&self.camera, self.render.width, self.render.height)
    }

    /// Evaluates the particles of [`Scene::effects`] for the scene's camera and image and puts them
    /// in the geometry (the instance BVH is built again; the meshes and their BVHs are kept). Sets
    /// of `kept` with the same parameters are reused instead of being evaluated again (only their
    /// BVH is built again when the camera or the image size changed). An effect whose material
    /// index is out of range renders with the default material, like an instance. A scene with
    /// more instances and effects than [`crate::geometry::MAX_INSTANCES`] keeps no particles.
    pub fn build_particles(&mut self, kept: Vec<ParticleSet>) {
        let width = crate::geometry::BvhWidth::native();
        let instances = self.geometry.instances().to_vec();
        let mut sets = particle_sets(
            &self.effects,
            kept,
            self.pixel_footprint(),
            width,
            &self.materials,
        );
        if instances.len() + sets.len() > crate::geometry::MAX_INSTANCES {
            sets.clear();
        }
        let meshes = std::mem::take(&mut self.geometry).into_meshes();
        // The instances come from a valid geometry and fit with the sets: this cannot fail.
        self.geometry =
            Geometry::with_particles(meshes, instances, sets, width).unwrap_or_default();
        self.apply_section();
    }

    /// Lays the front glass out again for the camera as it is now (S3): a host that changes the
    /// camera of a scene with a front glass without going through the RSB reader calls it.
    pub fn prepare_glass(&mut self) {
        if let Some(glass) = &self.glass {
            let params = *glass.params();
            let layout = glass.layout().cloned();
            self.glass = Some(crate::optics::glass::FrontGlass::laid_out(
                params,
                layout,
                &self.camera,
            ));
        }
    }

    /// Sets a front glass whose drops and motes are listed one by one (S3b: a simulated pane),
    /// for the camera as it is now.
    pub fn set_glass_layout(
        &mut self,
        params: crate::optics::glass::GlassParams,
        layout: crate::optics::glass::GlassLayout,
    ) {
        self.glass = Some(crate::optics::glass::FrontGlass::laid_out(
            params,
            Some(layout),
            &self.camera,
        ));
    }

    /// Sets the front glass (S3; `None` removes it), laid out for the camera.
    pub fn set_glass(&mut self, params: Option<crate::optics::glass::GlassParams>) {
        self.glass = params.map(|p| crate::optics::glass::FrontGlass::new(p, &self.camera));
    }

    /// Puts [`Scene::section`] in the geometry, which cuts and caps what its queries see (Q1).
    /// The materials say which instances are not capped (a thin wall has no inside). Call it
    /// after anything that rebuilds the geometry or changes the instances or the materials.
    pub fn apply_section(&mut self) {
        // S3c: the drops' caps are open shells: cut, never capped; S3e: so are the motes.
        let caps = self.caps.map(|c| c.instance as usize);
        let motes = self.motes.map(|c| c.instance as usize);
        let capped: Vec<bool> = self
            .geometry
            .instances()
            .iter()
            .enumerate()
            .map(|(k, i)| {
                Some(k) != caps
                    && Some(k) != motes
                    && self
                        .materials
                        .get(i.material_id as usize)
                        .is_none_or(|m| m.flags & MATERIAL_FLAG_THIN == 0)
            })
            .collect();
        self.geometry.set_section(self.section, &capped);
    }

    /// Builds the particles' BVHs again for the scene's camera and image size as they are now (a
    /// host that changed them after loading the file): nothing is evaluated again.
    pub fn refresh_particles(&mut self) {
        let kept = self.geometry.take_particles();
        if !kept.is_empty() || !self.effects.is_empty() {
            self.build_particles(kept);
        }
    }

    /// S3c: the mesh, instance and material of the drops' caps, after the file's own; `None`
    /// without drops.
    pub fn caps(&self) -> Option<Caps> {
        self.caps
    }

    /// S3d: the instance the part and material passes name for a hit on triangle `triangle` of
    /// instance `instance`: for a drop's cap the instance it lies on, for a drop in the air the
    /// instance it left; any other hit, `instance` itself.
    pub fn pass_instance(&self, instance: u32, triangle: u32) -> u32 {
        // S3e: a mote counts as the instance it lies on.
        if self.motes.is_some_and(|m| m.instance == instance) {
            return match self
                .mote_owners
                .get((triangle / crate::weather::MOTE_TRIANGLES) as usize)
            {
                Some(&owner) => owner,
                None => instance,
            };
        }
        let Some(c) = self.caps.filter(|c| c.instance == instance) else {
            return instance;
        };
        let per = c.cap_triangles.max(1);
        let in_caps = c.caps * per;
        let k = if triangle < in_caps {
            triangle / per
        } else {
            c.caps + (triangle - in_caps) / crate::weather::SPHERE_TRIANGLES
        };
        match self.cap_owners.get(k as usize) {
            Some(&owner) if owner != crate::weather::NO_INSTANCE => owner,
            _ => instance,
        }
    }

    /// S3e: where the weather's own meshes, instances and materials begin (the caps', then the
    /// motes'), after the file's.
    fn weather_start(&self) -> Option<Caps> {
        self.caps.or(self.motes)
    }

    /// S3c: the instances of the file (all of them but the caps'; S3e: and the motes').
    pub fn file_instances(&self) -> &[Instance] {
        let all = self.geometry.instances();
        &all[..self
            .weather_start()
            .map_or(all.len(), |c| c.instance as usize)]
    }

    /// S3c: the meshes of the file (all of them but the caps'; S3e: and the motes').
    pub fn file_meshes(&self) -> &[Mesh] {
        let all = self.geometry.meshes();
        &all[..self.weather_start().map_or(all.len(), |c| c.mesh as usize)]
    }

    /// S3c: the materials of the file (all of them but the caps' water; S3e: and the motes' dust).
    pub fn file_materials(&self) -> &[Material] {
        &self.materials[..self
            .weather_start()
            .map_or(self.materials.len(), |c| c.material as usize)]
    }

    /// S3e: the mesh, instance and material of the dust's motes, after the caps'; `None` without
    /// motes.
    pub fn motes(&self) -> Option<Caps> {
        self.motes
    }

    /// S3e: sets the rain, dust and snow on the studio floor ([`crate::weather::FloorWeather`]).
    /// Fails, leaving the scene as it was, when its numbers are out of range.
    pub fn set_wet_floor(
        &mut self,
        floor: Option<crate::weather::FloorWeather>,
    ) -> Result<(), &'static str> {
        if let Some(f) = &floor {
            f.check()?;
        }
        self.wet_floor = floor;
        Ok(())
    }

    /// S3c: sets the rain, dust and snow on the instances ([`crate::weather`]) and meshes their
    /// drops: the caps' mesh, instance and material come after the file's own. Fails, leaving the
    /// scene as it was, when a part names an instance that is not there or twice, its triangles are
    /// not its mesh's, or the drops are too many.
    pub fn set_wet_parts(
        &mut self,
        parts: Vec<crate::weather::PartWeather>,
    ) -> Result<(), &'static str> {
        crate::weather::check_parts(&parts, self.file_instances(), self.file_meshes())?;
        if self.file_instances().len() + self.geometry.particle_sets().len() + 1
            > crate::geometry::MAX_INSTANCES
            && (parts.iter().any(|p| !p.drops.is_empty()) || !self.wet_falling.is_empty())
        {
            return Err("too many instances for the drops");
        }
        self.detach_caps();
        self.wet_parts = parts;
        self.attach_caps();
        Ok(())
    }

    /// S3d: sets the drops in the air ([`crate::weather::FallingDrop`]) and meshes them with the
    /// caps. Fails, leaving the scene as it was, when one names an instance that is not there, is out
    /// of its range, or there is no room for the instance of the drops.
    pub fn set_wet_falling(
        &mut self,
        drops: Vec<crate::weather::FallingDrop>,
    ) -> Result<(), &'static str> {
        crate::weather::check_falling(&drops, self.file_instances().len())?;
        if self.file_instances().len() + self.geometry.particle_sets().len() + 1
            > crate::geometry::MAX_INSTANCES
            && !drops.is_empty()
        {
            return Err("too many instances for the drops");
        }
        self.detach_caps();
        self.wet_falling = drops;
        self.attach_caps();
        Ok(())
    }

    /// Takes the caps' mesh, instance and material out (S3e: and the motes').
    fn detach_caps(&mut self) {
        self.cap_owners.clear();
        self.mote_owners.clear();
        let start = self.weather_start();
        self.caps = None;
        self.motes = None;
        let Some(c) = start else { return };
        let width = crate::geometry::BvhWidth::native();
        let sets = self.geometry.take_particles();
        let mut instances = self.geometry.instances().to_vec();
        instances.truncate(c.instance as usize);
        let mut meshes = std::mem::take(&mut self.geometry).into_meshes();
        meshes.truncate(c.mesh as usize);
        self.materials.truncate(c.material as usize);
        self.geometry =
            Geometry::with_particles(meshes, instances, sets, width).unwrap_or_default();
        self.apply_section();
    }

    /// Meshes the drops of [`Scene::wet_parts`] and those in the air ([`Scene::wet_falling`]) after
    /// the file's own (validated) instances.
    fn attach_caps(&mut self) {
        let caps = crate::weather::caps_of(
            &self.wet_parts,
            self.geometry.instances(),
            self.geometry.meshes(),
        );
        let spheres: Vec<(Vec3, f32)> = self
            .wet_falling
            .iter()
            .map(|d| (d.position, d.radius))
            .collect();
        let shapes: Vec<crate::weather::Cap> = caps.iter().map(|c| c.1).collect();
        let Some(mesh) = crate::weather::water_mesh(&shapes, &spheres) else {
            self.attach_motes();
            return;
        };
        let owners: Vec<u32> = caps
            .iter()
            .map(|c| c.0)
            .chain(self.wet_falling.iter().map(|d| d.instance))
            .collect();
        let width = crate::geometry::BvhWidth::native();
        let sets = self.geometry.take_particles();
        let mut instances = self.geometry.instances().to_vec();
        let mut meshes = std::mem::take(&mut self.geometry).into_meshes();
        let at = Caps {
            mesh: meshes.len() as u32,
            instance: instances.len() as u32,
            material: self.materials.len() as u32,
            caps: caps.len() as u32,
            cap_triangles: crate::weather::cap_triangles(&shapes),
        };
        meshes.push(mesh);
        instances.push(Instance::new(at.mesh, Transform::IDENTITY, at.material));
        self.materials.push(crate::weather::water());
        match Geometry::with_particles(meshes, instances, sets, width) {
            Ok(g) => {
                self.geometry = g;
                self.caps = Some(at);
                self.cap_owners = owners;
            }
            Err(_) => {
                self.materials.pop();
            }
        }
        self.attach_motes();
    }

    /// S3e: meshes the motes of [`Scene::wet_parts`] after the caps (or after the file's own
    /// instances without caps).
    fn attach_motes(&mut self) {
        let file = self
            .caps
            .map_or(self.geometry.instances().len(), |c| c.instance as usize);
        let motes = crate::weather::motes_of(
            &self.wet_parts,
            &self.geometry.instances()[..file],
            self.geometry.meshes(),
        );
        let grains: Vec<(Vec3, Vec3, f32)> = motes.iter().map(|m| (m.1, m.2, m.3)).collect();
        if let Some(mesh) = crate::weather::mote_mesh(&grains) {
            let width = crate::geometry::BvhWidth::native();
            let sets = self.geometry.take_particles();
            let mut instances = self.geometry.instances().to_vec();
            let mut meshes = std::mem::take(&mut self.geometry).into_meshes();
            let at = Caps {
                mesh: meshes.len() as u32,
                instance: instances.len() as u32,
                material: self.materials.len() as u32,
                caps: motes.len() as u32,
                cap_triangles: crate::weather::MOTE_TRIANGLES,
            };
            meshes.push(mesh);
            instances.push(Instance::new(at.mesh, Transform::IDENTITY, at.material));
            self.materials.push(crate::weather::dust());
            match Geometry::with_particles(meshes, instances, sets, width) {
                Ok(g) => {
                    self.geometry = g;
                    self.motes = Some(at);
                    self.mote_owners = motes.iter().map(|m| m.0).collect();
                }
                Err(_) => {
                    self.materials.pop();
                }
            }
        }
        self.apply_section();
    }

    /// Number of distinct triangles (each mesh counted once, however many instances use it).
    pub fn triangle_count(&self) -> usize {
        self.geometry.triangle_count()
    }

    /// World bounding box of all geometry ([`Aabb::EMPTY`] when there is none).
    pub fn bounds(&self) -> Aabb {
        self.geometry.bounds()
    }

    /// The front-most surface along `ray` within `[t_min, t_max]`: instance, triangle, point,
    /// normals and barycentrics. Used to select, to focus by click and to place by reflection: the
    /// parts only, never the particles of an effect.
    pub fn pick(&self, ray: &Ray) -> Option<Hit> {
        self.geometry.intersect_class(
            ray,
            crate::simd::Isa::detect(),
            crate::geometry::RayClass::Seen,
        )
    }

    /// True when anything blocks `ray` within `[t_min, t_max]` (shadow rays, early exit).
    pub fn occluded(&self, ray: &Ray) -> bool {
        self.geometry.occluded(ray)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool {
        (a - b).length() < 1.0e-4
    }

    #[test]
    fn basis_is_orthonormal_and_right_handed() {
        let cam = Camera::default();
        let (f, r, u) = cam.basis();
        assert!(close(f, Vec3::new(0.0, 1.0, 0.0)));
        assert!(close(r, Vec3::new(1.0, 0.0, 0.0)));
        assert!(close(u, Vec3::new(0.0, 0.0, 1.0)));
    }

    #[test]
    fn basis_survives_degenerate_cameras() {
        let looking_down = Camera {
            position: Vec3::new(0.0, 0.0, 100.0),
            target: Vec3::ZERO,
            ..Camera::default()
        };
        let (f, r, u) = looking_down.basis();
        assert!((f.length() - 1.0).abs() < 1.0e-5);
        assert!((r.length() - 1.0).abs() < 1.0e-5);
        assert!((u.length() - 1.0).abs() < 1.0e-5);
        assert!(f.dot(r).abs() < 1.0e-5 && f.dot(u).abs() < 1.0e-5);
        let on_target = Camera {
            position: Vec3::ZERO,
            target: Vec3::ZERO,
            ..Camera::default()
        };
        assert!((on_target.basis().0.length() - 1.0).abs() < 1.0e-5);
    }

    #[test]
    fn centre_ray_points_at_the_target_and_corners_diverge() {
        let cam = Camera::default();
        let centre = cam.generate_ray(16.0 / 9.0, 0.5, 0.5, (0.0, 0.0));
        assert!(close(centre.origin, cam.position));
        assert!(close(centre.dir, Vec3::new(0.0, 1.0, 0.0)));
        // Right edge: half the 36 mm sensor over a 50 mm focal length.
        let right = cam.generate_ray(16.0 / 9.0, 1.0, 0.5, (0.0, 0.0));
        assert!((right.dir.x / right.dir.y - 18.0 / 50.0).abs() < 1.0e-5);
        // Top edge: sensor height is 36 / aspect and v = 0 is the top.
        let top = cam.generate_ray(16.0 / 9.0, 0.5, 0.0, (0.0, 0.0));
        assert!(top.dir.z > 0.0);
        assert!((top.dir.z / top.dir.y - 18.0 / (16.0 / 9.0) / 50.0).abs() < 1.0e-5);
    }

    #[test]
    fn portrait_images_fit_the_sensor_to_the_height() {
        let cam = Camera::default();
        let top = cam.generate_ray(0.5, 0.5, 0.0, (0.0, 0.0));
        assert!((top.dir.z / top.dir.y - 18.0 / 50.0).abs() < 1.0e-5);
    }

    #[test]
    fn orthographic_rays_are_parallel() {
        let cam = Camera {
            ortho: true,
            ortho_width: 200.0,
            ..Camera::default()
        };
        let a = cam.generate_ray(2.0, 0.0, 0.5, (0.0, 0.0));
        let b = cam.generate_ray(2.0, 1.0, 0.5, (0.0, 0.0));
        assert!(close(a.dir, b.dir));
        assert!(close(a.origin, cam.position + Vec3::new(-100.0, 0.0, 0.0)));
        assert!(close(b.origin, cam.position + Vec3::new(100.0, 0.0, 0.0)));
    }

    #[test]
    fn thin_lens_rays_converge_on_the_focus_plane() {
        let cam = Camera {
            fstop: 2.0,
            focus_dist: 1000.0,
            ..Camera::default()
        };
        assert!((cam.lens_radius() - 12.5).abs() < 1.0e-5);
        let a = cam.generate_ray(1.0, 0.3, 0.6, (0.0, 0.0));
        let b = cam.generate_ray(1.0, 0.3, 0.6, (0.8, -0.4));
        assert!(!close(a.origin, b.origin));
        // Both rays reach the same point on the plane y = focus_dist.
        let pa = a.at((cam.position.y + cam.focus_dist - a.origin.y) / a.dir.y);
        let pb = b.at((cam.position.y + cam.focus_dist - b.origin.y) / b.dir.y);
        assert!(close(pa, pb), "{pa:?} vs {pb:?}");
        // A pinhole ignores the lens sample.
        let pin = Camera {
            fstop: 0.0,
            ..Camera::default()
        };
        assert_eq!(
            pin.generate_ray(1.0, 0.3, 0.6, (0.9, 0.9)),
            pin.generate_ray(1.0, 0.3, 0.6, (0.0, 0.0))
        );
    }

    #[test]
    fn scene_counts_bounds_and_pick() {
        let mesh = Mesh::new(
            &[
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 2.0, 3.0),
            ],
            &[],
            &[0, 1, 2],
            0,
        )
        .expect("valid");
        let scene = Scene {
            geometry: Geometry::from_meshes(vec![mesh]),
            ..Scene::default()
        };
        assert_eq!(scene.triangle_count(), 1);
        assert_eq!(
            scene.bounds(),
            Aabb::new(Vec3::ZERO, Vec3::new(1.0, 2.0, 3.0))
        );
        let ray = Ray::new(Vec3::new(0.2, 0.2, -5.0), Vec3::new(0.0, 0.0, 1.0));
        let hit = scene.pick(&ray).expect("hit");
        assert_eq!((hit.instance, hit.triangle), (0, 0));
        assert!(scene.occluded(&ray));
        assert!(Scene::default().bounds().is_empty());
        assert_eq!(Scene::default().pick(&ray), None);
    }

    #[test]
    fn enum_codes_round_trip() {
        for k in [
            LightKind::Rect,
            LightKind::Disk,
            LightKind::Sun,
            LightKind::Point,
            LightKind::Spot,
            LightKind::Ies,
        ] {
            assert_eq!(LightKind::from_u32(k.to_u32()), Some(k));
        }
        for k in [EnvKind::Studio, EnvKind::Flat, EnvKind::Sky, EnvKind::Hdri] {
            assert_eq!(EnvKind::from_u32(k.to_u32()), Some(k));
        }
        for m in [
            FloorMode::None,
            FloorMode::Visible,
            FloorMode::ShadowCatcher,
        ] {
            assert_eq!(FloorMode::from_u32(m.to_u32()), Some(m));
        }
        assert_eq!(LightKind::from_u32(6), None);
        assert_eq!(EnvKind::from_u32(4), None);
        assert_eq!(FloorMode::from_u32(3), None);
    }

    #[test]
    fn background_modes_and_depth_decode() {
        let mut env = Environment::default();
        for (mode, want) in [
            (0, Background::Environment),
            (1, Background::Color),
            (2, Background::Transparent),
            (3, Background::Backplate),
            (77, Background::Environment),
        ] {
            env.background_mode = mode;
            assert_eq!(env.background(), want);
        }
        let mut render = RenderSettings::default();
        assert_eq!(render.depth(), 8);
        render.max_depth = 0;
        assert_eq!(render.depth(), 8);
        render.max_depth = 3;
        assert_eq!(render.depth(), 3);
        render.max_depth = u32::MAX;
        assert_eq!(render.depth(), RenderSettings::MAX_DEPTH_LIMIT);
        let emitter = Material {
            kind: MATERIAL_EMISSIVE,
            emission: Rgb::new(1.0, 0.5, -1.0),
            emission_power: 4.0,
            ..Material::default()
        };
        assert_eq!(emitter.radiance(), Rgb::new(4.0, 2.0, 0.0));
        assert_eq!(Material::default().radiance(), Rgb::BLACK);
    }
}

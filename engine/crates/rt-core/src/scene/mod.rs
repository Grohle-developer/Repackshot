//! The in-memory scene and its binary interchange format ([`rsb`]).
//!
//! Units are millimetres for distances and degrees for angles. The world is Z-up.

pub mod rsb;

pub use crate::bitmap::Bitmap;
use crate::color::Rgb;
use crate::math::{Aabb, Ray, Vec3};

pub use crate::geometry::{
    Geometry, GeometryError, Hit, Instance, Mesh, MeshError, RayHit, Transform, INSTANCE_ONE_SIDED,
};
pub use rsb::RsbError;

/// A camera: thin lens perspective or orthographic.
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

    /// Radius of the lens aperture in scene units, zero for a pinhole.
    pub fn lens_radius(&self) -> f32 {
        if self.fstop > 0.0 && self.focus_dist > 0.0 && !self.ortho {
            self.focal_mm / self.fstop * 0.5
        } else {
            0.0
        }
    }

    /// Generates the camera ray through the image point `(u, v)`.
    ///
    /// `u` runs left to right and `v` top to bottom, both in `[0, 1]`. `aspect` is
    /// `width / height`. `lens` is a point in the unit disk used to sample the aperture; it is
    /// ignored for a pinhole or orthographic camera. The returned direction is normalised.
    pub fn generate_ray(&self, aspect: f32, u: f32, v: f32, lens: (f32, f32)) -> Ray {
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
    /// 3: a point light. Reserved for phase L4: parsed and kept, not rendered yet.
    Point,
    /// 4: a spot light. Reserved for phase L4: parsed and kept, not rendered yet.
    Spot,
}

impl LightKind {
    /// Decodes the RSB value (0 rect, 1 disk, 2 sun, 3 point, 4 spot).
    pub fn from_u32(value: u32) -> Option<LightKind> {
        match value {
            0 => Some(LightKind::Rect),
            1 => Some(LightKind::Disk),
            2 => Some(LightKind::Sun),
            3 => Some(LightKind::Point),
            4 => Some(LightKind::Spot),
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
        }
    }
}

/// Light flag (bit 0): the light is seen by BSDF-sampled rays (reflections) and lights every
/// lobe. Without it the light only lights the diffuse lobe, through explicit sampling, and is
/// invisible in reflections (Blender's "glossy" ray visibility, where the recipes come from).
pub const LIGHT_FLAG_GLOSSY: u32 = 1;
/// Light flag (bit 1): the light is directly visible to camera rays.
pub const LIGHT_FLAG_CAMERA: u32 = 2;

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
    /// Width (rect) or diameter (disk), in scene units.
    pub size_x: f32,
    /// Height (rect), in scene units.
    pub size_y: f32,
    /// Emitted colour in linear RGB.
    pub color: Rgb,
    /// Rect and disk: radiant flux in watts leaving the front face without spread falloff
    /// (scene millimetres are read as 1e-3 m, so the radiance is `power / (π · area_m2)`). Sun:
    /// irradiance in W/m^2 on a surface facing it.
    pub power: f32,
    /// Beam spread in degrees: 180 is a bare diffuser (Lambertian); smaller values add a
    /// `cos^n` falloff whose intensity halves at `spread_deg / 2` from the normal.
    pub spread_deg: f32,
    /// Angular diameter in degrees (sun).
    pub angle_deg: f32,
    /// Bit set of `LIGHT_FLAG_*` values.
    pub flags: u32,
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
}

impl RenderSettings {
    /// Largest accepted image width or height.
    pub const MAX_DIMENSION: u32 = 16_384;
    /// Path depth used when `max_depth` is 0.
    pub const DEFAULT_MAX_DEPTH: u32 = 8;
    /// Largest path depth the renderer honours.
    pub const MAX_DEPTH_LIMIT: u32 = 1024;

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
}

impl Scene {
    /// Number of distinct triangles (each mesh counted once, however many instances use it).
    pub fn triangle_count(&self) -> usize {
        self.geometry.triangle_count()
    }

    /// World bounding box of all geometry ([`Aabb::EMPTY`] when there is none).
    pub fn bounds(&self) -> Aabb {
        self.geometry.bounds()
    }

    /// The front-most surface along `ray` within `[t_min, t_max]`: instance, triangle, point,
    /// normals and barycentrics. Used to select, to focus by click and to place by reflection.
    pub fn pick(&self, ray: &Ray) -> Option<Hit> {
        self.geometry.intersect(ray)
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
        assert_eq!(LightKind::from_u32(5), None);
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

//! The in-memory scene and its binary interchange format ([`rsb`]).
//!
//! Units are millimetres for distances and degrees for angles. The world is Z-up.

pub mod rsb;

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

/// A surface material. E1 stores the parameters; the path tracer (E3) interprets them.
#[derive(Clone, Debug, PartialEq)]
pub struct Material {
    /// Material model identifier (reserved: stored verbatim, 0 is the default PBR model).
    pub kind: u32,
    /// Diffuse or metal colour in linear RGB.
    pub base_color: Rgb,
    /// 0 = dielectric, 1 = metal.
    pub metallic: f32,
    /// Microfacet roughness in `[0, 1]`.
    pub roughness: f32,
    /// Index of refraction.
    pub ior: f32,
    /// Fraction of light transmitted instead of reflected, in `[0, 1]`.
    pub transmission: f32,
    /// Clear coat strength in `[0, 1]`.
    pub coat: f32,
    /// Clear coat roughness in `[0, 1]`.
    pub coat_roughness: f32,
    /// Emitted colour in linear RGB.
    pub emission: Rgb,
    /// Emission multiplier.
    pub emission_power: f32,
}

impl Default for Material {
    fn default() -> Material {
        Material {
            kind: 0,
            base_color: Rgb::splat(0.8),
            metallic: 0.0,
            roughness: 0.5,
            ior: 1.5,
            transmission: 0.0,
            coat: 0.0,
            coat_roughness: 0.0,
            emission: Rgb::BLACK,
            emission_power: 0.0,
        }
    }
}

/// Shape of a light source.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LightKind {
    /// A rectangle of `size_x x size_y`, emitting along `direction`.
    Rect,
    /// A disk of diameter `size_x`, emitting along `direction`.
    Disk,
    /// A distant sun; light travels along `direction`.
    Sun,
}

impl LightKind {
    /// Decodes the RSB value (0 = rect, 1 = disk, 2 = sun).
    pub fn from_u32(value: u32) -> Option<LightKind> {
        match value {
            0 => Some(LightKind::Rect),
            1 => Some(LightKind::Disk),
            2 => Some(LightKind::Sun),
            _ => None,
        }
    }

    /// The RSB value of this kind.
    pub fn to_u32(self) -> u32 {
        match self {
            LightKind::Rect => 0,
            LightKind::Disk => 1,
            LightKind::Sun => 2,
        }
    }
}

/// Light flag: the light is visible in glossy reflections.
pub const LIGHT_FLAG_GLOSSY: u32 = 1;
/// Light flag: the light is directly visible to the camera.
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
    /// Power of the light (units are defined by the path tracer in E3).
    pub power: f32,
    /// Beam spread in degrees.
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

/// Kind of environment lighting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnvKind {
    /// Procedural studio: floor, horizon and zenith brightness.
    Studio,
    /// A single flat colour of brightness `horizon`.
    Flat,
}

impl EnvKind {
    /// Decodes the RSB value (0 = studio, 1 = flat).
    pub fn from_u32(value: u32) -> Option<EnvKind> {
        match value {
            0 => Some(EnvKind::Studio),
            1 => Some(EnvKind::Flat),
            _ => None,
        }
    }

    /// The RSB value of this kind.
    pub fn to_u32(self) -> u32 {
        match self {
            EnvKind::Studio => 0,
            EnvKind::Flat => 1,
        }
    }
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
    /// Backdrop mode (reserved: stored verbatim, interpreted by the path tracer in E3).
    pub background_mode: u32,
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
    /// Tone mapping operator: 0 = linear, 1 = ACES (see [`crate::color::Tonemap`]).
    pub tonemap: u32,
}

impl RenderSettings {
    /// Largest accepted image width or height.
    pub const MAX_DIMENSION: u32 = 16_384;
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
    /// Image size and sampling settings.
    pub render: RenderSettings,
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
        for k in [LightKind::Rect, LightKind::Disk, LightKind::Sun] {
            assert_eq!(LightKind::from_u32(k.to_u32()), Some(k));
        }
        for k in [EnvKind::Studio, EnvKind::Flat] {
            assert_eq!(EnvKind::from_u32(k.to_u32()), Some(k));
        }
        assert_eq!(LightKind::from_u32(3), None);
        assert_eq!(EnvKind::from_u32(2), None);
    }
}

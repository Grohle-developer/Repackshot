//! The E5 and E5c scenes of the contact sheet: glass, coat, anisotropy, emitters, the daylight
//! sky (classic, then physical against classic) and an HDRI, built here in code (they are engine
//! fixtures, not catalogue setups), and the procedural studio HDRI that `rt --write-studio-hdri`
//! writes (`tests/fixtures/studio.hdr`).

use crate::sheet::TOTAL_IRRADIANCE;
use rt_core::bitmap::Bitmap;
use rt_core::color::Rgb;
use rt_core::fmath;
use rt_core::math::Vec3;
use rt_core::scene::{
    Camera, EnvKind, Environment, Floor, FloorMode, Geometry, Instance, Light, LightKind, Material,
    Mesh, RenderSettings, Scene, SkyModel, Transform, BACKGROUND_COLOR, LIGHT_FLAG_CAMERA,
    LIGHT_FLAG_GLOSSY, MATERIAL_EMISSIVE, MATERIAL_FLAG_LIGHT, MATERIAL_FLAG_THIN, MATERIAL_GLASS,
};

/// Size of the procedural studio HDRI.
pub const STUDIO_HDRI_SIZE: (u32, u32) = (1024, 512);

/// One scene of the sheet.
pub struct E5Scene {
    /// File name stem and JSON key.
    pub key: &'static str,
    /// Caption.
    pub label: &'static str,
    /// The scene.
    pub scene: Scene,
    /// Samples per pixel relative to the sheet's (glass converges slower).
    pub sample_factor: u32,
}

/// The colour of a black body at `kelvin`, normalised to its largest channel: the same fit as the
/// interface's `kelvinToRgb` (`src/core/light-math.ts`), so the sheet's lights look like the
/// catalogue's.
pub fn kelvin_rgb(kelvin: f32) -> Rgb {
    let t = kelvin.clamp(1000.0, 12000.0) / 100.0;
    let r = if t <= 66.0 {
        255.0
    } else {
        329.698_73 * fmath::powf(t - 60.0, -0.133_204_76)
    };
    let g = if t <= 66.0 {
        99.470_8 * fmath::ln(t) - 161.119_57
    } else {
        288.122_17 * fmath::powf(t - 60.0, -0.075_514_85)
    };
    let b = if t >= 66.0 {
        255.0
    } else if t <= 19.0 {
        0.0
    } else {
        138.517_73 * fmath::ln(t - 10.0) - 305.044_8
    };
    let c = Rgb::new(r, g, b).map(|v| v.clamp(0.0, 255.0));
    let largest = c.r.max(c.g).max(c.b).max(1.0);
    c / largest
}

/// Smooth step from 0 at `a` to 1 at `b`.
fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// A soft-edged rectangle of the sky in azimuth and elevation (degrees): 1 inside, 0 outside,
/// a 2 degree edge.
fn softbox(az: f32, el: f32, centre: (f32, f32), half: (f32, f32)) -> f32 {
    let mut d = az - centre.0;
    while d > 180.0 {
        d -= 360.0;
    }
    while d < -180.0 {
        d += 360.0;
    }
    let inside_az = 1.0 - smoothstep(half.0 - 1.0, half.0 + 1.0, d.abs());
    let inside_el = 1.0 - smoothstep(half.1 - 1.0, half.1 + 1.0, (el - centre.1).abs());
    inside_az * inside_el
}

/// The procedural studio panorama: a dark grey cyclorama (0.02 straight down, 0.05 at the
/// horizon, 0.12 straight up) with four soft boxes: a large key (12 W/(sr m²)) front left of +X,
/// a dimmer fill, a narrow rim strip behind and a top light. Equirectangular in the engine's
/// convention ([`rt_core::environment`]); `3 * w * h` linear floats, rows top to bottom.
pub fn studio_hdri(w: u32, h: u32) -> Vec<f32> {
    let mut rgb = Vec::with_capacity((3 * w * h) as usize);
    for y in 0..h {
        let v = (y as f32 + 0.5) / h as f32;
        let (st, ct) = fmath::sin_cos(fmath::PI * v);
        for x in 0..w {
            let u = (x as f32 + 0.5) / w as f32;
            let (sp, cp) = fmath::sin_cos(fmath::TAU * (u - 0.5));
            let d = Vec3::new(st * cp, -st * sp, ct);
            let az = fmath::atan2(d.y, d.x) / fmath::DEG_TO_RAD;
            let el = fmath::asin(d.z) / fmath::DEG_TO_RAD;
            let z = d.z;
            let mut c = if z < 0.0 {
                Rgb::splat(0.05 * (1.0 + z) + 0.02 * -z)
            } else {
                Rgb::splat(0.05 * (1.0 - z) + 0.12 * z)
            };
            c += Rgb::new(1.0, 0.97, 0.92) * (12.0 * softbox(az, el, (40.0, 25.0), (18.0, 14.0)));
            c += Rgb::new(0.92, 0.96, 1.0) * (3.0 * softbox(az, el, (-60.0, 15.0), (22.0, 18.0)));
            c += Rgb::splat(18.0 * softbox(az, el, (160.0, 20.0), (4.0, 30.0)));
            c += Rgb::splat(6.0 * softbox(az, el, (0.0, 72.0), (40.0, 10.0)));
            rgb.extend_from_slice(&[c.r, c.g, c.b]);
        }
    }
    rgb
}

/// The studio HDRI as the bytes of a Radiance `.hdr` file (`tests/fixtures/studio.hdr`).
pub fn studio_hdri_file() -> Vec<u8> {
    let (w, h) = STUDIO_HDRI_SIZE;
    rt_core::hdr::encode(w, h, &studio_hdri(w, h))
}

/// A solid of revolution about +Z: `profile` is `(radius, z)` points; it is closed when it starts
/// and ends on the axis. Vertices are shared between neighbouring profile segments whose normals
/// differ by less than `crease_deg`, so curves are smooth and corners sharp. Wound so that the
/// normals point to the left of the profile's direction of travel (outwards for a profile that
/// goes out along the bottom, up the outside and back in along the top).
pub fn lathe(profile: &[(f32, f32)], segments: u32, crease_deg: f32, material_id: u32) -> Mesh {
    let n = profile.len();
    // Normal of each profile segment in the (r, z) plane, pointing outwards.
    let seg_normal = |i: usize| {
        let (r0, z0) = profile[i];
        let (r1, z1) = profile[i + 1];
        let (dr, dz) = (r1 - r0, z1 - z0);
        let len = (dr * dr + dz * dz).sqrt().max(1.0e-9);
        (dz / len, -dr / len)
    };
    let cos_crease = fmath::cos(crease_deg * fmath::DEG_TO_RAD);
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();
    for i in 0..n - 1 {
        let ns = seg_normal(i);
        // Each end shares the neighbour's normal when the angle between them is small.
        let blend = |j: Option<usize>| -> (f32, f32) {
            match j {
                Some(j) => {
                    let o = seg_normal(j);
                    if o.0 * ns.0 + o.1 * ns.1 >= cos_crease {
                        let (a, b) = (o.0 + ns.0, o.1 + ns.1);
                        let l = (a * a + b * b).sqrt().max(1.0e-9);
                        (a / l, b / l)
                    } else {
                        ns
                    }
                }
                None => ns,
            }
        };
        let start = blend(i.checked_sub(1));
        let end = blend((i + 1 < n - 1).then_some(i + 1));
        let base = positions.len() as u32;
        for s in 0..=segments {
            let (sa, ca) = fmath::sin_cos(fmath::TAU * s as f32 / segments as f32);
            for (k, (r, z)) in [profile[i], profile[i + 1]].into_iter().enumerate() {
                positions.push(Vec3::new(r * ca, r * sa, z));
                let (nr, nz) = if k == 0 { start } else { end };
                normals.push(Vec3::new(nr * ca, nr * sa, nz));
            }
        }
        for s in 0..segments {
            let a = base + 2 * s;
            let (b, c, d) = (a + 1, a + 2, a + 3);
            // a: (i, s), b: (i + 1, s), c: (i, s + 1), d: (i + 1, s + 1).
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    Mesh::new(&positions, &normals, &indices, material_id).unwrap_or_default()
}

/// A camera at `position` looking at `target` with `focal_mm`, Z up.
fn camera(position: Vec3, target: Vec3, focal_mm: f32) -> Camera {
    Camera {
        position,
        target,
        up: Vec3::new(0.0, 0.0, 1.0),
        focal_mm,
        sensor_mm: 36.0,
        fstop: 0.0,
        focus_dist: (target - position).length(),
        ortho: false,
        ortho_width: 100.0,
    }
}

fn settings(size: (u32, u32), max_depth: u32, exposure_ev: f32) -> RenderSettings {
    RenderSettings {
        width: size.0,
        height: size.1,
        max_samples: 0,
        seed: 5,
        max_seconds: 0.0,
        exposure_ev,
        tonemap: 2,
        max_depth,
        clamp_indirect: 0.0,
        passes: 0,
        denoise: 0,
        caustic_photons: 0,
        caustic_radius: 0.0,
    }
}

/// The studio dome of the catalogue (`src/data/environment.ts`) at `strength`.
fn dome(strength: f32) -> Environment {
    Environment {
        kind: EnvKind::Studio,
        floor: 0.12,
        horizon: 0.45,
        zenith: 0.85,
        strength,
        background_color: Rgb::splat(0.6),
        background_mode: BACKGROUND_COLOR,
        ..Environment::default()
    }
}

/// A rect light at `position` aimed at `target`, `power` watts of flux.
fn panel(position: Vec3, target: Vec3, size: (f32, f32), power: f32, flags: u32) -> Light {
    Light {
        kind: LightKind::Rect,
        position,
        direction: (target - position).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: size.0,
        size_y: size.1,
        color: Rgb::WHITE,
        power,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags,
    }
}

fn glass(base: Rgb, roughness: f32, absorption_mm: f32) -> Material {
    Material {
        kind: MATERIAL_GLASS,
        base_color: base,
        roughness,
        ior: 1.5,
        transmission: 1.0,
        absorption_mm,
        ..Material::default()
    }
}

/// A perfume bottle of thick glass (a solid of revolution with a 3 mm wall and an 8 mm base,
/// tinted by absorption) and a brushed gold cap (anisotropic, its tangents around the bottle's
/// axis), on a white floor, between two soft boxes and in front of a backlit panel that the
/// camera sees (the bright field of the BACKLIT setup through and around the glass).
pub fn glass_bottle(size: (u32, u32)) -> Scene {
    let body = [
        (0.0, 0.0),
        (33.0, 0.0),
        (35.0, 2.0),
        (35.0, 85.0),
        (32.0, 92.0),
        (24.0, 98.0),
        (12.0, 102.0),
        (10.0, 104.0),
        (10.0, 112.0),
        (7.0, 112.0),
        (7.0, 104.0),
        (9.0, 101.0),
        (21.0, 95.5),
        (29.0, 89.5),
        (32.0, 84.0),
        (32.0, 10.0),
        (30.0, 8.0),
        (0.0, 8.0),
    ];
    let cap = [
        (0.0, 106.0),
        (14.0, 106.0),
        (14.0, 128.0),
        (13.0, 130.0),
        (0.0, 130.0),
    ];
    let meshes = vec![lathe(&body, 96, 30.0, 0), lathe(&cap, 96, 30.0, 0)];
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(1, Transform::IDENTITY, 1),
    ];
    let target = Vec3::new(0.0, 0.0, 62.0);
    Scene {
        camera: camera(Vec3::new(0.0, -560.0, 150.0), target, 85.0),
        materials: vec![
            glass(Rgb::new(0.78, 0.93, 0.88), 0.0, 40.0),
            Material {
                base_color: Rgb::new(1.0, 0.77, 0.34),
                metallic: 1.0,
                roughness: 0.28,
                anisotropy: 0.8,
                ..Material::default()
            },
        ],
        geometry: Geometry::new(meshes, instances).unwrap_or_default(),
        lights: vec![
            panel(
                Vec3::new(-420.0, -380.0, 300.0),
                target,
                (500.0, 700.0),
                2.0,
                LIGHT_FLAG_GLOSSY,
            ),
            panel(
                Vec3::new(380.0, 180.0, 220.0),
                target,
                (120.0, 600.0),
                0.8,
                LIGHT_FLAG_GLOSSY,
            ),
            panel(
                Vec3::new(0.0, 420.0, 120.0),
                Vec3::new(0.0, 0.0, 120.0),
                (700.0, 500.0),
                3.0,
                LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
            ),
        ],
        environment: dome(0.5),
        floor: Floor {
            mode: FloorMode::Visible,
            z: 0.0,
            color: Rgb::splat(0.8),
        },
        render: settings(size, 24, 0.0),
        bitmaps: Vec::new(),
        patterns: Vec::new(),
    }
}

/// Five spheres under the studio HDRI, which is also the background: red car paint (a clear coat
/// over a rough base), brushed aluminium (anisotropic), polished chrome, frosted glass and blue
/// glass coloured by absorption.
pub fn materials_board(size: (u32, u32)) -> Scene {
    let (w, h) = STUDIO_HDRI_SIZE;
    let hdri = Bitmap::from_linear(w, h, &studio_hdri(w, h)).ok();
    let sphere = rt_core::example::icosphere(Vec3::new(0.0, 0.0, 40.0), 40.0, 4);
    let xs = [-200.0f32, -100.0, 0.0, 100.0, 200.0];
    let instances = xs
        .iter()
        .enumerate()
        .map(|(i, &x)| Instance::new(0, Transform::translation(Vec3::new(x, 0.0, 0.0)), i as u32))
        .collect();
    let target = Vec3::new(0.0, 0.0, 40.0);
    Scene {
        camera: camera(Vec3::new(0.0, -900.0, 260.0), target, 50.0),
        materials: vec![
            Material {
                base_color: Rgb::new(0.55, 0.02, 0.03),
                roughness: 0.45,
                coat: 1.0,
                coat_roughness: 0.03,
                ..Material::default()
            },
            Material {
                base_color: Rgb::new(0.9, 0.91, 0.92),
                metallic: 1.0,
                roughness: 0.32,
                anisotropy: 0.85,
                ..Material::default()
            },
            Material {
                base_color: Rgb::new(0.95, 0.95, 0.96),
                metallic: 1.0,
                roughness: 0.04,
                ..Material::default()
            },
            glass(Rgb::WHITE, 0.35, 0.0),
            glass(Rgb::new(0.25, 0.45, 0.9), 0.0, 30.0),
        ],
        geometry: Geometry::new(vec![sphere], instances).unwrap_or_default(),
        lights: Vec::new(),
        environment: Environment {
            kind: EnvKind::Hdri,
            hdri_map: 0,
            strength: 1.0,
            rotation_deg: 0.0,
            background_mode: 0,
            ..Environment::default()
        },
        floor: Floor {
            mode: FloorMode::Visible,
            z: 0.0,
            color: Rgb::splat(0.35),
        },
        render: settings(size, 16, 0.0),
        bitmaps: hdri.into_iter().collect(),
        patterns: Vec::new(),
    }
}

/// A table lamp in a dark room: a filament (an emissive coil at 2700 K, sampled as a light)
/// inside a bulb of thin glass, on a lacquered stand, lighting a white sphere and a red box.
pub fn lamp(size: (u32, u32)) -> Scene {
    let base = lathe(
        &[
            (0.0, 0.0),
            (55.0, 0.0),
            (55.0, 8.0),
            (50.0, 12.0),
            (8.0, 16.0),
            (6.0, 18.0),
            (6.0, 150.0),
            (14.0, 155.0),
            (14.0, 168.0),
            (0.0, 168.0),
        ],
        64,
        30.0,
        0,
    );
    // The bulb: a thin sphere of radius 32 above the socket.
    let bulb = rt_core::example::icosphere(Vec3::new(0.0, 0.0, 200.0), 32.0, 4);
    // The filament: a torus (a coil, seen from afar).
    let mut ring = Vec::new();
    let steps = 32;
    for i in 0..=steps {
        let a = fmath::TAU * i as f32 / steps as f32;
        let (s, c) = fmath::sin_cos(a);
        ring.push((8.0 + 1.6 * c, 1.6 * s));
    }
    let filament = lathe(&ring, 48, 89.0, 0);
    let filament_at = Transform::translation(Vec3::new(0.0, 0.0, 200.0));
    let ball = rt_core::example::icosphere(Vec3::new(170.0, 60.0, 45.0), 45.0, 3);
    let cube = rt_core::example::icosphere(Vec3::ZERO, 1.0, 0);
    let cube_mesh = {
        // A 70 mm box rotated a little, as an icosphere of 20 faces would not do: build quads.
        let c = |x: f32, y: f32, z: f32| Vec3::new(x, y, z);
        let p = [
            c(-35.0, -35.0, 0.0),
            c(35.0, -35.0, 0.0),
            c(35.0, 35.0, 0.0),
            c(-35.0, 35.0, 0.0),
            c(-35.0, -35.0, 70.0),
            c(35.0, -35.0, 70.0),
            c(35.0, 35.0, 70.0),
            c(-35.0, 35.0, 70.0),
        ];
        let quads: [[u32; 4]; 6] = [
            [0, 3, 2, 1],
            [4, 5, 6, 7],
            [0, 1, 5, 4],
            [2, 3, 7, 6],
            [1, 2, 6, 5],
            [3, 0, 4, 7],
        ];
        let idx: Vec<u32> = quads
            .iter()
            .flat_map(|q| [q[0], q[1], q[2], q[0], q[2], q[3]])
            .collect();
        Mesh::new(&p, &[], &idx, 0).unwrap_or(cube)
    };
    let (s, c) = fmath::sin_cos(25.0 * fmath::DEG_TO_RAD);
    let cube_at = Transform::from_rows([
        [c, -s, 0.0, -170.0],
        [s, c, 0.0, 40.0],
        [0.0, 0.0, 1.0, 0.0],
    ]);
    let meshes = vec![base, bulb, filament, ball, cube_mesh];
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(1, Transform::IDENTITY, 1),
        Instance::new(2, filament_at, 2),
        Instance::new(3, Transform::IDENTITY, 3),
        Instance::new(4, cube_at, 4),
    ];
    let target = Vec3::new(0.0, 0.0, 110.0);
    Scene {
        camera: camera(Vec3::new(60.0, -820.0, 300.0), target, 50.0),
        materials: vec![
            Material {
                base_color: Rgb::new(0.04, 0.04, 0.045),
                roughness: 0.35,
                coat: 1.0,
                coat_roughness: 0.05,
                ..Material::default()
            },
            Material {
                flags: MATERIAL_FLAG_THIN,
                ..glass(Rgb::WHITE, 0.0, 0.0)
            },
            Material {
                kind: MATERIAL_EMISSIVE,
                emission: kelvin_rgb(2700.0),
                emission_power: 900.0,
                flags: MATERIAL_FLAG_LIGHT,
                ..Material::default()
            },
            Material {
                base_color: Rgb::splat(0.8),
                roughness: 0.4,
                ..Material::default()
            },
            Material {
                base_color: Rgb::new(0.6, 0.06, 0.04),
                roughness: 0.5,
                ..Material::default()
            },
        ],
        geometry: Geometry::new(meshes, instances).unwrap_or_default(),
        lights: Vec::new(),
        environment: Environment {
            strength: 0.04,
            background_color: Rgb::splat(0.002),
            ..dome(0.04)
        },
        floor: Floor {
            mode: FloorMode::Visible,
            z: 0.0,
            color: Rgb::splat(0.6),
        },
        render: settings(size, 16, 0.5),
        bitmaps: Vec::new(),
        patterns: Vec::new(),
    }
}

/// One of the catalogue's three SKY setups (src/data/light-setups.ts) as E5 rendered it, under the
/// classic sky: [`sky_setup_with`] the classic model and turbidity 3.
pub fn sky_setup(size: (u32, u32), azimuth: f32, elevation: f32, kelvin: f32) -> Scene {
    sky_setup_with(size, azimuth, elevation, kelvin, SkyModel::Classic, 3.0)
}

/// A sun at `azimuth` and `elevation` degrees (azimuth 0 behind the camera, negative to its
/// left), 0.545 degrees wide, of colour temperature `kelvin`, over the daylight sky `model` of
/// turbidity `turbidity` whose sun it is. The example part on a visible floor (the example's floor
/// quad is left out: it would lie on the floor plane), seen low enough to show the sky.
pub fn sky_setup_with(
    size: (u32, u32),
    azimuth: f32,
    elevation: f32,
    kelvin: f32,
    model: SkyModel,
    turbidity: f32,
) -> Scene {
    let mut scene = rt_core::example::scene();
    let meshes = scene.geometry.meshes().to_vec();
    let instances = scene
        .geometry
        .instances()
        .iter()
        .filter(|i| i.mesh != 1)
        .cloned()
        .collect();
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.render = settings(size, 8, 0.0);
    scene.camera.position = Vec3::new(560.0, -900.0, 160.0);
    scene.camera.target = Vec3::new(0.0, 0.0, 130.0);
    scene.camera.focal_mm = 50.0;
    scene.camera.fstop = 0.0;
    let view = scene.camera.position - scene.camera.target;
    let camera_azimuth = fmath::atan2(view.x, -view.y) / fmath::DEG_TO_RAD;
    // As `sheet::direction`: azimuth 0 behind the camera, negative to its left.
    let (sa, ca) = fmath::sin_cos((camera_azimuth + azimuth) * fmath::DEG_TO_RAD);
    let (se, ce) = fmath::sin_cos(elevation * fmath::DEG_TO_RAD);
    let to_sun = Vec3::new(ce * sa, -ce * ca, se);
    scene.lights = vec![Light {
        kind: LightKind::Sun,
        position: scene.camera.target,
        direction: -to_sun,
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 0.0,
        size_y: 0.0,
        color: kelvin_rgb(kelvin),
        power: TOTAL_IRRADIANCE,
        spread_deg: 180.0,
        angle_deg: 0.545,
        flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
    }];
    scene.environment = Environment {
        kind: EnvKind::Sky,
        floor: 0.12,
        horizon: 0.45,
        zenith: 0.85,
        strength: 0.6,
        background_mode: 0,
        sky_turbidity: turbidity,
        sky_model: model,
        sun_azimuth_deg: fmath::atan2(to_sun.y, to_sun.x) / fmath::DEG_TO_RAD,
        sun_elevation_deg: elevation,
        ..Environment::default()
    };
    scene.floor = Floor {
        mode: FloorMode::Visible,
        z: 0.0,
        color: Rgb::splat(0.3),
    };
    scene
}

/// The catalogue's SUN setup: 55 degrees up and 55 to the left of the camera, 5200 K.
pub fn sun_sky(size: (u32, u32)) -> Scene {
    sky_setup(size, -55.0, 55.0, 5200.0)
}

/// The example part lit by the studio HDRI alone (shown behind it): the large sphere in polished
/// chrome mirrors the soft boxes, the small one is glossy white plastic.
pub fn hdri_studio(size: (u32, u32)) -> Scene {
    let (w, h) = STUDIO_HDRI_SIZE;
    let mut scene = rt_core::example::scene();
    scene.render = settings(size, 8, 0.0);
    scene.lights.clear();
    scene.materials[0] = Material {
        base_color: Rgb::new(0.95, 0.95, 0.96),
        metallic: 1.0,
        roughness: 0.05,
        ..Material::default()
    };
    scene.materials[2] = Material {
        base_color: Rgb::splat(0.85),
        roughness: 0.2,
        coat: 0.6,
        coat_roughness: 0.02,
        ..Material::default()
    };
    scene.bitmaps = Bitmap::from_linear(w, h, &studio_hdri(w, h))
        .into_iter()
        .collect();
    scene.environment = Environment {
        kind: EnvKind::Hdri,
        hdri_map: 0,
        strength: 1.0,
        rotation_deg: 20.0,
        background_mode: 0,
        ..Environment::default()
    };
    scene
}

/// A disc light of `diameter` mm at `position` aimed at `target`, `power` watts, glossy.
fn disc(position: Vec3, target: Vec3, diameter: f32, power: f32) -> Light {
    Light {
        kind: LightKind::Disk,
        position,
        direction: (target - position).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: diameter,
        size_y: diameter,
        color: Rgb::WHITE,
        power,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_GLOSSY,
    }
}

/// E5b-1: a clear glass sphere (30 mm radius, ior 1.5) on a white floor under a small disc light
/// (16 mm across, 354 mm away, from behind and above), a dim studio dome: the sphere's focus of
/// light falls on the floor in front of it, towards the camera. With `photons` caustic photons
/// per sample (0: none, the path tracer alone).
pub fn caustic_sphere(size: (u32, u32), photons: u32) -> Scene {
    let sphere = rt_core::example::icosphere(Vec3::new(0.0, 0.0, 30.0), 30.0, 5);
    let mut render = settings(size, 16, 0.0);
    render.caustic_photons = photons;
    Scene {
        camera: camera(
            Vec3::new(0.0, 300.0, 170.0),
            Vec3::new(0.0, 25.0, 12.0),
            50.0,
        ),
        materials: vec![glass(Rgb::WHITE, 0.0, 0.0)],
        geometry: Geometry::new(vec![sphere], vec![Instance::new(0, Transform::IDENTITY, 0)])
            .unwrap_or_default(),
        lights: vec![disc(
            Vec3::new(0.0, -250.0, 280.0),
            Vec3::new(0.0, 0.0, 30.0),
            16.0,
            2.0,
        )],
        environment: dome(0.08),
        floor: Floor {
            mode: FloorMode::Visible,
            z: 0.0,
            color: Rgb::splat(0.8),
        },
        render,
        bitmaps: Vec::new(),
        patterns: Vec::new(),
    }
}

/// E5b-1: the perfume bottle of [`glass_bottle`] under one small key light (a 40 mm panel from
/// behind and to the left, high) and a dim dome: its glass throws a caustic on the floor in
/// front of it. With `photons` caustic photons per sample (0: none).
pub fn bottle_caustics(size: (u32, u32), photons: u32) -> Scene {
    let mut scene = glass_bottle(size);
    let target = Vec3::new(0.0, 0.0, 40.0);
    scene.lights = vec![panel(
        Vec3::new(-260.0, 300.0, 420.0),
        target,
        (40.0, 40.0),
        3.0,
        LIGHT_FLAG_GLOSSY,
    )];
    scene.environment = dome(0.12);
    scene.render.caustic_photons = photons;
    scene
}

/// Caustic photons per sample of the sheet's caustic scenes (the interface's *Medium*).
pub const SHEET_CAUSTIC_PHOTONS: u32 = 16_384;

/// One E5b-1 scene of the sheet: a scene and how it is rendered.
pub struct E5bScene {
    /// File name stem and JSON key.
    pub key: &'static str,
    /// Caption.
    pub label: &'static str,
    /// The scene (with `RNDR.denoise` when it is to be denoised).
    pub scene: Scene,
    /// Samples relative to the sheet's (without `low_samples`).
    pub sample_factor: u32,
    /// Rendered at 4 samples per pixel, to show the denoiser at work.
    pub low_samples: bool,
    /// The denoised image is written.
    pub denoise: bool,
}

/// The E5b-1 pairs of the sheet at `size`: the glass sphere and the perfume bottle without and
/// with caustics, the bottle's caustics at the Final preset's samples without and with denoise,
/// and two scenes at 4 samples per pixel without and with denoise.
pub fn e5b_scenes(size: (u32, u32)) -> Vec<E5bScene> {
    let pair =
        |keys: [&'static str; 2], labels: [&'static str; 2], scene: &dyn Fn(u32) -> Scene| {
            [0, SHEET_CAUSTIC_PHOTONS].map(|photons| {
                let i = usize::from(photons > 0);
                E5bScene {
                    key: keys[i],
                    label: labels[i],
                    scene: scene(photons),
                    sample_factor: 4,
                    low_samples: false,
                    denoise: false,
                }
            })
        };
    let noisy_clean = |keys: [&'static str; 2], labels: [&'static str; 2], scene: Scene| {
        [false, true].map(|clean| {
            let mut scene = scene.clone();
            if clean {
                scene.render.denoise = rt_core::scene::DENOISE_IMAGE;
            }
            E5bScene {
                key: keys[usize::from(clean)],
                label: labels[usize::from(clean)],
                scene,
                sample_factor: 1,
                low_samples: true,
                denoise: clean,
            }
        })
    };
    let recipe = crate::sheet::recipes()
        .into_iter()
        .find(|r| r.key == "key-only")
        .map(|r| crate::sheet::scene_for(&r, size))
        .unwrap_or_else(|| glass_bottle(size));
    pair(
        ["e5b-sphere-caustics-off", "e5b-sphere-caustics-on"],
        [
            "Glass sphere under a small disc light, the path tracer alone",
            "Glass sphere under a small disc light, caustics from the photon map",
        ],
        &|photons| caustic_sphere(size, photons),
    )
    .into_iter()
    .chain(pair(
        ["e5b-bottle-caustics-off", "e5b-bottle-caustics-on"],
        [
            "Perfume bottle under a small key light, the path tracer alone",
            "Perfume bottle under a small key light, caustics from the photon map",
        ],
        &|photons| bottle_caustics(size, photons),
    ))
    .chain([false, true].map(|clean| {
        // The caustic at the Final preset's samples (16 × the sheet's 64: 1024), without and
        // with denoise: the radius has shrunk to about a third of the first one by then.
        let mut scene = bottle_caustics(size, SHEET_CAUSTIC_PHOTONS);
        if clean {
            scene.render.denoise = rt_core::scene::DENOISE_IMAGE;
        }
        E5bScene {
            key: if clean {
                "e5b-bottle-caustics-final-denoised"
            } else {
                "e5b-bottle-caustics-final"
            },
            label: if clean {
                "Perfume bottle, caustics at the Final preset's samples, denoised"
            } else {
                "Perfume bottle, caustics at the Final preset's samples"
            },
            scene,
            sample_factor: 16,
            low_samples: false,
            denoise: clean,
        }
    }))
    .chain(noisy_clean(
        ["e5b-key-4spp-noisy", "e5b-key-4spp-denoised"],
        [
            "Key light only at 4 samples per pixel",
            "Key light only at 4 samples per pixel, denoised",
        ],
        recipe,
    ))
    .chain(noisy_clean(
        ["e5b-bottle-4spp-noisy", "e5b-bottle-4spp-denoised"],
        [
            "Glass bottle (backlit) at 4 samples per pixel",
            "Glass bottle (backlit) at 4 samples per pixel, denoised",
        ],
        glass_bottle(size),
    ))
    .collect()
}

/// Every E5 scene of the sheet at `size`.
pub fn e5_scenes(size: (u32, u32)) -> Vec<E5Scene> {
    vec![
        E5Scene {
            key: "e5-glass-bottle",
            label: "Glass bottle (absorption) with a brushed gold cap, backlit panel",
            scene: glass_bottle(size),
            sample_factor: 4,
        },
        E5Scene {
            key: "e5-materials",
            label:
                "Car paint, brushed aluminium, chrome, frosted and blue glass under the studio HDRI",
            scene: materials_board(size),
            sample_factor: 4,
        },
        E5Scene {
            key: "e5-lamp",
            label: "Emissive filament in a thin glass bulb",
            scene: lamp(size),
            sample_factor: 4,
        },
        E5Scene {
            key: "e5-sky-sun",
            label: "SUN setup (5200 K, 55 degrees up) under the daylight sky",
            scene: sun_sky(size),
            sample_factor: 1,
        },
        E5Scene {
            key: "e5-sky-golden-hour",
            label: "GOLDEN_HOUR setup (2900 K, 12 degrees up, from behind) under the daylight sky",
            scene: sky_setup(size, -120.0, 12.0, 2900.0),
            sample_factor: 1,
        },
        E5Scene {
            key: "e5-sky-dawn",
            label: "DAWN setup (3600 K, 8 degrees up, grazing) under the daylight sky",
            scene: sky_setup(size, 110.0, 8.0, 3600.0),
            sample_factor: 1,
        },
        E5Scene {
            key: "e5-hdri-studio",
            label: "Chrome and plastic lit by the studio HDRI alone",
            scene: hdri_studio(size),
            sample_factor: 2,
        },
    ]
    .into_iter()
    .chain(e5c_scenes(size))
    .collect()
}

/// The E5c comparison of the sheet: the same setups under the physical sky and the classic one.
pub fn e5c_scenes(size: (u32, u32)) -> Vec<E5Scene> {
    let pair = |key: [&'static str; 2],
                label: [&'static str; 2],
                azimuth: f32,
                elevation: f32,
                kelvin: f32,
                turbidity: f32| {
        [(SkyModel::Physical, 0), (SkyModel::Classic, 1)].map(|(model, i)| E5Scene {
            key: key[i],
            label: label[i],
            scene: sky_setup_with(size, azimuth, elevation, kelvin, model, turbidity),
            sample_factor: 1,
        })
    };
    [
        pair(
            ["e5c-sunrise-physical", "e5c-sunrise-classic"],
            [
                "Sunrise (2 degrees, 2200 K, behind the part), physical sky, turbidity 3",
                "Sunrise (2 degrees, 2200 K, behind the part), classic sky, turbidity 3",
            ],
            160.0,
            2.0,
            2200.0,
            3.0,
        ),
        pair(
            ["e5c-golden-physical", "e5c-golden-classic"],
            [
                "Golden hour (8 degrees, 2900 K, from behind), physical sky, turbidity 3",
                "Golden hour (8 degrees, 2900 K, from behind), classic sky, turbidity 3",
            ],
            -120.0,
            8.0,
            2900.0,
            3.0,
        ),
        pair(
            ["e5c-noon-physical", "e5c-noon-classic"],
            [
                "Noon (65 degrees, 5500 K), physical sky, turbidity 3",
                "Noon (65 degrees, 5500 K), classic sky, turbidity 3",
            ],
            -55.0,
            65.0,
            5500.0,
            3.0,
        ),
        pair(
            ["e5c-hazy-physical", "e5c-hazy-classic"],
            [
                "Hazy afternoon (25 degrees, 4500 K, behind the part), physical sky, turbidity 7",
                "Hazy afternoon (25 degrees, 4500 K, behind the part), classic sky, turbidity 7",
            ],
            140.0,
            25.0,
            4500.0,
            7.0,
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_studio_hdri_fixture_is_what_the_generator_writes() {
        let file = studio_hdri_file();
        let fixture = include_bytes!("../../../../tests/fixtures/studio.hdr");
        assert!(
            file == fixture[..],
            "tests/fixtures/studio.hdr is stale: run `rt --write-studio-hdri tests/fixtures/studio.hdr`"
        );
        let img = rt_core::hdr::decode(&file, 1 << 22).expect("decode");
        assert_eq!((img.width, img.height), STUDIO_HDRI_SIZE);
        // The key light, 40 degrees from +X towards +Y and 25 up: u = ½ - 40/360, v = 65/180.
        let (w, h) = STUDIO_HDRI_SIZE;
        let x = ((0.5 - 40.0 / 360.0) * w as f32) as usize;
        let y = (65.0 / 180.0 * h as f32) as usize;
        let i = 3 * (y * w as usize + x);
        assert!(img.rgb[i] > 10.0, "{:?}", &img.rgb[i..i + 3]);
        // Straight down is the dark floor of the cyclorama.
        let bottom = 3 * ((h as usize - 1) * w as usize);
        assert!(img.rgb[bottom] < 0.03);
    }

    #[test]
    fn lathes_are_closed_and_point_outwards() {
        let cylinder = lathe(
            &[(0.0, 0.0), (10.0, 0.0), (10.0, 20.0), (0.0, 20.0)],
            32,
            30.0,
            0,
        );
        assert!(!cylinder.inside_out());
        // The side's normals are radial, the caps' vertical.
        for i in 0..cylinder.vertex_count() {
            let (p, n) = (cylinder.position(i).unwrap(), cylinder.normal(i).unwrap());
            if p.z > 0.0 && p.z < 20.0 {
                let radial = Vec3::new(p.x, p.y, 0.0).normalize();
                assert!((n - radial).length() < 1.0e-4 || n.z.abs() > 0.99);
            }
        }
        let scenes = e5_scenes((32, 24));
        assert_eq!(scenes.len(), 7 + 8);
        // The E5 sky setups keep the classic sky; the E5c pairs differ only in the model.
        assert_eq!(sun_sky((32, 24)).environment.sky_model, SkyModel::Classic);
        let e5c = e5c_scenes((32, 24));
        for pair in e5c.chunks(2) {
            assert_eq!(pair[0].scene.environment.sky_model, SkyModel::Physical);
            assert_eq!(pair[1].scene.environment.sky_model, SkyModel::Classic);
            let mut same = pair[1].scene.clone();
            same.environment.sky_model = SkyModel::Physical;
            assert_eq!(same, pair[0].scene);
        }
        // The sky scenes leave the example's floor quad out: it would lie on the visible floor plane.
        let sky = sun_sky((32, 24));
        assert_eq!(sky.geometry.instances().len(), 2);
        assert!(sky.geometry.instances().iter().all(|i| i.mesh == 0));
        for s in &scenes {
            assert!(Scene::from_rsb(&s.scene.to_rsb()).is_ok(), "{}", s.key);
            assert!(s.scene.triangle_count() > 0);
        }
    }

    #[test]
    fn kelvin_matches_the_interface() {
        // `kelvinToRgb(5200)` and `kelvinToRgb(2700)` of src/core/light-math.ts.
        let sun = kelvin_rgb(5200.0);
        assert_eq!(sun.r, 1.0);
        assert!(
            (sun.g - 0.909_47).abs() < 1.0e-4 && (sun.b - 0.834_07).abs() < 1.0e-4,
            "{sun:?}"
        );
        let warm = kelvin_rgb(2700.0);
        assert!(
            (warm.g - 0.653_80).abs() < 1.0e-4 && (warm.b - 0.342_77).abs() < 1.0e-4,
            "{warm:?}"
        );
    }
}

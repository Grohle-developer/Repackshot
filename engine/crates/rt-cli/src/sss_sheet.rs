//! `rt --sss-sheet <dir>`: the E9 contact sheet of the scattering media. Each translucent recipe
//! of the catalogue as a sphere (nine on a white floor, backlit by a soft key), and the perfume
//! bottle of the E5 sheet filled with milk and with orange juice; every scene with and without
//! its medium (the same materials with `scatter_mm` 0), and the milk bottle once more with the
//! caustic photons of E5b-1 (the light that reaches the milk through the bottle's glass, which
//! shadow rays do not cross), at `N` and `4 N` samples per pixel (default 64 and 256), with the
//! time and the rays per camera sample each took. Writes `sss-sheet.html` and `sss/*.png` into
//! `<dir>`, and rewrites the page after every image so a long run can be looked at as it goes.
//!
//! The recipes are the values of `src/data/materials.ts` (GLASS family) mapped as
//! `src/io/rsb.ts` `materialToRsb` maps them: a test of `tests/e9-materials.test.ts` reads this
//! file and checks that the numbers agree.

use crate::render_progressive;
use crate::scenes::{glass_bottle, lathe};
use crate::sheet::image_stats;
use rt_core::color::Rgb;
use rt_core::math::Vec3;
use rt_core::scene::{
    Camera, EnvKind, Environment, Floor, FloorMode, Geometry, Instance, Light, LightKind, Material,
    RenderSettings, Scene, Transform, BACKGROUND_COLOR, LIGHT_FLAG_GLOSSY, MATERIAL_GLASS,
};
use std::fmt::Write as _;
use std::path::Path;

/// Default image size.
pub const SIZE: (u32, u32) = (320, 240);
/// Default lower sample count (the higher one is 4 times it).
pub const SAMPLES: u32 = 64;

/// One translucent recipe: key, caption, GLASS-family values.
pub struct Recipe {
    /// Catalogue key (`src/data/materials.ts`).
    pub key: &'static str,
    /// Caption.
    pub label: &'static str,
    /// The material as the engine receives it.
    pub material: Material,
}

/// A GLASS-family material with a medium, as `materialToRsb` writes it.
#[allow(clippy::too_many_arguments)]
fn medium(
    base: [f32; 3],
    roughness: f32,
    ior: f32,
    absorption_mm: f32,
    scatter_mm: f32,
    albedo: [f32; 3],
    g: f32,
) -> Material {
    Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::new(base[0], base[1], base[2]),
        roughness,
        ior,
        transmission: 1.0,
        absorption_mm,
        scatter_mm,
        scatter_color: Rgb::new(albedo[0], albedo[1], albedo[2]),
        scatter_g: g,
        ..Material::default()
    }
}

/// The nine translucent recipes of E9, in catalogue order.
pub fn recipes() -> Vec<Recipe> {
    let r = |key, label, material| Recipe {
        key,
        label,
        material,
    };
    vec![
        r(
            "HDPE_WHITE",
            "White HDPE",
            medium([1.0; 3], 0.35, 1.54, 0.0, 0.08, [0.996, 0.995, 0.99], 0.0),
        ),
        r(
            "PP_NATURAL",
            "Natural PP",
            medium([1.0; 3], 0.3, 1.49, 0.0, 0.6, [0.995, 0.994, 0.988], 0.0),
        ),
        r(
            "PMMA_FROST",
            "Frosted acrylic",
            medium([1.0; 3], 0.45, 1.49, 0.0, 4.0, [0.999, 0.999, 0.999], 0.3),
        ),
        r(
            "WAX",
            "Wax",
            medium([1.0; 3], 0.4, 1.44, 0.0, 0.35, [0.997, 0.993, 0.975], 0.0),
        ),
        r(
            "SOAP_GLYCERIN",
            "Glycerine soap",
            medium(
                [0.93, 0.72, 0.42],
                0.12,
                1.47,
                60.0,
                12.0,
                [0.995, 0.99, 0.98],
                0.4,
            ),
        ),
        r(
            "MILK",
            "Milk",
            medium(
                [1.0; 3],
                0.0,
                1.35,
                0.0,
                0.31,
                [0.9996, 0.9993, 0.9963],
                0.0,
            ),
        ),
        r(
            "JUICE_ORANGE",
            "Orange juice",
            medium([1.0; 3], 0.0, 1.35, 0.0, 0.9, [0.997, 0.94, 0.55], 0.0),
        ),
        r(
            "JUICE_APPLE",
            "Apple juice",
            medium(
                [0.86, 0.55, 0.16],
                0.0,
                1.35,
                25.0,
                40.0,
                [1.0, 1.0, 1.0],
                0.5,
            ),
        ),
        r(
            "CREAM",
            "Cream",
            medium(
                [1.0; 3],
                0.25,
                1.4,
                0.0,
                0.19,
                [0.99997, 0.9995, 0.9949],
                0.0,
            ),
        ),
    ]
}

/// `m` without its medium.
fn clear(m: &Material) -> Material {
    Material {
        scatter_mm: 0.0,
        ..m.clone()
    }
}

fn render_settings(size: (u32, u32)) -> RenderSettings {
    RenderSettings {
        width: size.0,
        height: size.1,
        max_samples: 0,
        seed: 9,
        max_seconds: 0.0,
        exposure_ev: 0.0,
        tonemap: 2,
        max_depth: 24,
        clamp_indirect: 0.0,
        passes: 0,
        denoise: 0,
        caustic_photons: 0,
        caustic_radius: 0.0,
        denoise_strength: 1.0,
        pixel_filter: 0,
        edge_supersample: 1,
    }
}

fn soft_dome(strength: f32) -> Environment {
    Environment {
        kind: EnvKind::Studio,
        floor: 0.12,
        horizon: 0.45,
        zenith: 0.85,
        strength,
        background_color: Rgb::splat(0.55),
        background_mode: BACKGROUND_COLOR,
        ..Environment::default()
    }
}

fn panel(position: Vec3, target: Vec3, size: f32, power: f32) -> Light {
    Light {
        kind: LightKind::Rect,
        position,
        direction: (target - position).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: size,
        size_y: size,
        color: Rgb::WHITE,
        power,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_GLOSSY,
    }
}

/// The nine recipes as spheres of 22 mm radius in a 3 × 3 grid on a white floor, backlit by a
/// soft key from behind and to the left, a dim fill in front and the studio dome.
pub fn spheres(size: (u32, u32), with_medium: bool) -> Scene {
    let all = recipes();
    let mesh = rt_core::example::icosphere(Vec3::new(0.0, 0.0, 22.0), 22.0, 4);
    let mut instances = Vec::new();
    let mut materials = Vec::new();
    for (i, r) in all.iter().enumerate() {
        let (col, row) = ((i % 3) as f32 - 1.0, (i / 3) as f32 - 1.0);
        let t = Transform::from_rows([
            [1.0, 0.0, 0.0, col * 62.0],
            [0.0, 1.0, 0.0, -row * 62.0],
            [0.0, 0.0, 1.0, 0.0],
        ]);
        instances.push(Instance::new(0, t, i as u32));
        materials.push(if with_medium {
            r.material.clone()
        } else {
            clear(&r.material)
        });
    }
    let target = Vec3::new(0.0, 0.0, 18.0);
    let position = Vec3::new(0.0, -330.0, 260.0);
    Scene {
        camera: Camera {
            position,
            target,
            up: Vec3::new(0.0, 0.0, 1.0),
            focal_mm: 50.0,
            sensor_mm: 36.0,
            fstop: 0.0,
            focus_dist: (target - position).length(),
            ortho: false,
            ortho_width: 100.0,
            lens: None,
        },
        materials,
        geometry: Geometry::new(vec![mesh], instances).unwrap_or_default(),
        lights: vec![
            panel(Vec3::new(-260.0, 320.0, 240.0), target, 300.0, 3.0),
            panel(Vec3::new(200.0, -420.0, 160.0), target, 500.0, 0.6),
        ],
        environment: soft_dome(0.35),
        floor: Floor {
            mode: FloorMode::Visible,
            z: 0.0,
            color: Rgb::splat(0.75),
        },
        render: render_settings(size),
        bitmaps: Vec::new(),
        patterns: Vec::new(),
        effects: Vec::new(),
    }
}

/// The perfume bottle of the E5 sheet ([`glass_bottle`]) filled to 60 mm with `liquid` (0.05 mm
/// of air between the liquid and the glass).
pub fn bottle(size: (u32, u32), liquid: Material) -> Scene {
    let mut scene = glass_bottle(size);
    let profile = [
        (0.0, 8.05),
        (29.95, 8.05),
        (31.95, 10.05),
        (31.95, 60.0),
        (0.0, 60.0),
    ];
    let mut meshes = scene.geometry.meshes().to_vec();
    let mut instances = scene.geometry.instances().to_vec();
    meshes.push(lathe(&profile, 96, 30.0, 0));
    scene.materials.push(liquid);
    instances.push(Instance::new(
        meshes.len() as u32 - 1,
        Transform::IDENTITY,
        scene.materials.len() as u32 - 1,
    ));
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.render = render_settings(size);
    scene.render.max_depth = 32;
    scene
}

/// One rendered image of the sheet.
pub struct Entry {
    /// File stem.
    pub key: String,
    /// Caption.
    pub label: String,
    /// Samples per pixel.
    pub samples: u32,
    /// Render time, seconds.
    pub seconds: f64,
    /// Rays cast per camera sample (the cost, whatever the machine's load).
    pub rays_per_sample: f64,
    /// Mean luma of the encoded image.
    pub mean: f64,
}

/// The scenes of the sheet: key, caption, scene.
fn scenes(size: (u32, u32)) -> Vec<(String, String, Scene)> {
    let find = |key: &str| {
        recipes()
            .into_iter()
            .find(|r| r.key == key)
            .map(|r| r.material)
            .unwrap_or_default()
    };
    let mut out = Vec::new();
    for with in [true, false] {
        let tag = if with { "medium" } else { "clear" };
        let words = if with {
            "with the medium"
        } else {
            "without the medium"
        };
        out.push((
            format!("spheres-{tag}"),
            format!("The nine recipes, {words} (row by row: HDPE, PP, frosted acrylic; wax, soap, milk; orange, apple, cream)"),
            spheres(size, with),
        ));
        for (key, label) in [("MILK", "milk"), ("JUICE_ORANGE", "orange juice")] {
            let m = find(key);
            out.push((
                format!("bottle-{}-{tag}", key.to_ascii_lowercase()),
                format!("Perfume bottle filled with {label}, {words}"),
                bottle(size, if with { m } else { clear(&m) }),
            ));
        }
    }
    let mut lit = bottle(size, find("MILK"));
    lit.render.caustic_photons = crate::scenes::SHEET_CAUSTIC_PHOTONS;
    out.push((
        "bottle-milk-medium-caustics".into(),
        "Perfume bottle filled with milk, with the medium and the caustic photons".into(),
        lit,
    ));
    out
}

/// Renders the sheet into `dir` at `samples` and `4 × samples` per pixel.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    threads: usize,
) -> Result<Vec<Entry>, String> {
    let images = dir.join("sss");
    std::fs::create_dir_all(&images).map_err(|e| format!("{}: {e}", images.display()))?;
    let mut entries = Vec::new();
    for spp in [samples, samples.saturating_mul(4)] {
        for (key, label, scene) in scenes(size) {
            let out = render_progressive(&scene, spp, threads, None);
            let rgb8 = out.to_rgb8(&scene);
            let file = format!("{key}-{spp}.png");
            let path = images.join(&file);
            crate::write_png(&path, size.0, size.1, &rgb8)
                .map_err(|e| format!("{}: {e}", path.display()))?;
            let camera_samples = f64::from(size.0) * f64::from(size.1) * f64::from(out.samples);
            entries.push(Entry {
                key: format!("{key}-{spp}"),
                label,
                samples: out.samples,
                seconds: out.elapsed.as_secs_f64(),
                rays_per_sample: out.rays as f64 / camera_samples.max(1.0),
                mean: image_stats(&rgb8).mean_luminance,
            });
            let page = dir.join("sss-sheet.html");
            std::fs::write(&page, html(&entries, size))
                .map_err(|e| format!("{}: {e}", page.display()))?;
        }
    }
    Ok(entries)
}

/// The sheet as a self-contained page.
pub fn html(entries: &[Entry], size: (u32, u32)) -> String {
    let mut s = String::new();
    s.push_str(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>Scattering media sheet</title>\n<style>\n\
         :root { color-scheme: light dark; --bg: #f4f4f4; --fg: #1a1a1a; --muted: #666; }\n\
         @media (prefers-color-scheme: dark) { :root { --bg: #141414; --fg: #e8e8e8; --muted: #999; } }\n\
         body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg);\n\
                font: 14px/1.4 system-ui, sans-serif; }\n\
         h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }\n\
         p.meta { margin: 0 0 20px; color: var(--muted); max-width: 70em; }\n\
         .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }\n\
         figure { margin: 0; }\n img { width: 100%; height: auto; display: block; }\n\
         figcaption { margin-top: 6px; }\n\
         figcaption span { display: block; color: var(--muted); font-variant-numeric: tabular-nums; }\n\
         </style>\n</head>\n<body>\n<h1>Scattering media (E9b)</h1>\n",
    );
    let _ = writeln!(
        s,
        "<p class=\"meta\">The translucent recipes of the catalogue and the perfume bottle filled \
         with milk and orange juice, {}x{}, with and without the medium (the same material with a \
         mean free path of 0), and the milk bottle with the caustic photons, at the sheet's two \
         sample counts, with the render time (four threads on a shared machine) and the rays per \
         camera sample. Filmic curve, exposure 0.</p>\n<div class=\"grid\">",
        size.0, size.1
    );
    for e in entries {
        let _ = writeln!(
            s,
            "<figure><img src=\"sss/{key}.png\" width=\"{w}\" height=\"{h}\" alt=\"{label}\">\
             <figcaption>{label}<span>{spp} spp · {secs:.1} s · {rays:.1} rays per sample · mean {mean:.3}</span></figcaption></figure>",
            key = e.key,
            w = size.0,
            h = size.1,
            label = e.label,
            spp = e.samples,
            secs = e.seconds,
            rays = e.rays_per_sample,
            mean = e.mean
        );
    }
    s.push_str("</div>\n</body>\n</html>\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_has_every_recipe_and_its_scenes_are_valid() {
        let all = recipes();
        assert_eq!(all.len(), 9);
        for r in &all {
            assert!(
                rt_core::integrator::medium::of(&r.material).is_some(),
                "{}",
                r.key
            );
            assert!(rt_core::integrator::medium::of(&clear(&r.material)).is_none());
        }
        let size = (32, 24);
        let s = spheres(size, true);
        assert_eq!(s.geometry.instances().len(), 9);
        assert_eq!(Scene::from_rsb(&s.to_rsb()).as_ref(), Ok(&s));
        let b = bottle(size, all[5].material.clone());
        assert_eq!(b.materials.len(), 3);
        let all_scenes = scenes(size);
        assert_eq!(all_scenes.len(), 7);
        assert!(all_scenes[6].2.render.caustic_photons > 0);
        let html = html(
            &[Entry {
                key: "spheres-medium-64".into(),
                label: "x".into(),
                samples: 64,
                seconds: 1.0,
                rays_per_sample: 3.0,
                mean: 0.5,
            }],
            size,
        );
        assert!(html.starts_with("<!doctype html>") && html.contains("sss/spheres-medium-64.png"));
    }
}

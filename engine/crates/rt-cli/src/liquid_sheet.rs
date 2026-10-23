//! `rt --liquid-sheet <dir>`: the S7 contact sheet of the liquids. Each preset of
//! `src/data/liquids.ts` poured into the example glass (a block falls into it from inside its rim,
//! splashes and settles), simulated by `rt_phys::liquid` and rendered at the end of the pour with
//! its look, the glass's priority above the liquid's (nested dielectrics); then water halfway
//! through the pour, and water at rest again without the priorities (its contact with the glass
//! as against air), to compare. Writes `liquid-sheet.html` and `liquid/*.png` into `<dir>`, and
//! rewrites the page after every image so a long run can be looked at as it goes.
//!
//! The presets repeat `src/data/liquids.ts` (and, for milk and orange juice, the catalogue's
//! recipes of `src/data/materials.ts`) as the engine receives them: a test of
//! `tests/s7-liquids.test.ts` reads this file and checks that the numbers agree.

use crate::render_progressive;
use crate::sheet::image_stats;
use rt_core::color::{Rgb, Tonemap};
use rt_core::math::Vec3;
use rt_core::scene::{Camera, Material, DENOISE_IMAGE, MATERIAL_GLASS};
use rt_phys::example::box_mesh;
use rt_phys::liquid::example::{glass_material, glass_mesh, render_scene};
use rt_phys::liquid::{LiquidParams, LiquidSource, LiquidSpec, LiquidWorld, Runner, StaticPiece};
use rt_phys::Transform;
use std::fmt::Write as _;
use std::path::Path;
use std::time::Instant;

/// Default image size.
pub const SIZE: (u32, u32) = (320, 320);
/// Default samples per pixel.
pub const SAMPLES: u32 = 128;
/// The particle spacing of the pour, mm.
pub const SPACING: f32 = 2.5;
/// Steps the pour runs before the picture (two seconds).
pub const STEPS: u32 = 480;

/// One preset: key, caption, how it moves, how it looks.
pub struct Preset {
    /// Its key in `src/data/liquids.ts`.
    pub key: &'static str,
    /// Caption.
    pub label: &'static str,
    /// How it moves.
    pub params: LiquidParams,
    /// How it looks, as `materialToRsb` writes a GLASS-family material.
    pub look: Material,
}

/// How a preset moves: density, viscosity (mm²/s), cohesion, surface tension, adhesion.
fn moves(
    density: f32,
    viscosity: f32,
    cohesion: f32,
    surface_tension: f32,
    adhesion: f32,
) -> LiquidParams {
    LiquidParams {
        density,
        viscosity,
        cohesion,
        surface_tension,
        adhesion,
    }
}

/// A GLASS-family look: base colour, roughness, index, absorption distance, mean free path,
/// single-scattering albedo, Henyey–Greenstein g.
#[allow(clippy::too_many_arguments)]
fn look(
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

/// The presets, in the order of `src/data/liquids.ts`.
pub fn presets() -> Vec<Preset> {
    let p = |key, label, params, look| Preset {
        key,
        label,
        params,
        look,
    };
    vec![
        p(
            "WATER",
            "Water",
            moves(998.0, 1.0, 0.1, 0.02, 0.05),
            look([0.86, 0.95, 0.97], 0.0, 1.333, 2000.0, 0.0, [1.0; 3], 0.0),
        ),
        p(
            "OIL",
            "Oil",
            moves(910.0, 80.0, 0.08, 0.015, 0.1),
            look([0.82, 0.72, 0.2], 0.0, 1.467, 40.0, 0.0, [1.0; 3], 0.0),
        ),
        p(
            "HONEY",
            "Honey",
            moves(1420.0, 10000.0, 0.3, 0.05, 0.5),
            look([0.85, 0.47, 0.08], 0.0, 1.49, 25.0, 0.0, [1.0; 3], 0.0),
        ),
        p(
            "MILK",
            "Milk",
            moves(1030.0, 2.0, 0.1, 0.02, 0.05),
            look(
                [1.0; 3],
                0.0,
                1.35,
                0.0,
                0.31,
                [0.9996, 0.9993, 0.9963],
                0.0,
            ),
        ),
        p(
            "GEL",
            "Gel",
            moves(1010.0, 20000.0, 0.4, 0.05, 0.6),
            look([0.74, 0.9, 1.0], 0.02, 1.35, 60.0, 0.0, [1.0; 3], 0.0),
        ),
        p(
            "SYRUP",
            "Syrup",
            moves(1330.0, 1500.0, 0.2, 0.04, 0.3),
            look([0.62, 0.3, 0.06], 0.0, 1.45, 15.0, 0.0, [1.0; 3], 0.0),
        ),
        p(
            "JUICE_ORANGE",
            "Orange juice",
            moves(1045.0, 2.5, 0.1, 0.02, 0.05),
            look([1.0; 3], 0.0, 1.35, 0.0, 0.9, [0.997, 0.94, 0.55], 0.0),
        ),
        p(
            "WINE",
            "Red wine",
            moves(990.0, 1.2, 0.1, 0.02, 0.05),
            look([0.55, 0.04, 0.08], 0.0, 1.34, 6.0, 0.0, [1.0; 3], 0.0),
        ),
    ]
}

/// The example glass (outer radius 35 mm, inner 32, 110 mm tall, a bottom 6 mm thick) and a block
/// of 40 × 40 × 55 mm of `params` standing in it from 44 mm above its bottom.
pub fn pour(params: LiquidParams) -> LiquidSpec {
    LiquidSpec {
        meshes: vec![
            glass_mesh(35.0, 32.0, 110.0, 6.0, 64),
            box_mesh(Vec3::new(20.0, 20.0, 27.5)),
        ],
        statics: vec![StaticPiece {
            mesh: 0,
            transform: Transform::IDENTITY,
        }],
        floor: Some(0.0),
        liquids: vec![LiquidSource {
            mesh: 1,
            transform: Transform::translation(Vec3::new(0.0, 0.0, 50.0 + 27.5)),
            spacing: SPACING,
            params,
        }],
    }
}

/// The sheet's camera: the glass from the front, a little above its rim.
pub fn camera() -> Camera {
    let target = Vec3::new(0.0, 0.0, 42.0);
    let position = Vec3::new(70.0, -330.0, 175.0);
    Camera {
        position,
        target,
        up: Vec3::new(0.0, 0.0, 1.0),
        focal_mm: 85.0,
        fstop: 0.0,
        focus_dist: (target - position).length(),
        ..Camera::default()
    }
}

/// The chunks of each pass on threads of their own.
struct Threads;

impl Runner for Threads {
    fn run(&self, jobs: usize, job: &(dyn Fn(usize) -> Vec<f32> + Sync)) -> Vec<Vec<f32>> {
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..jobs).map(|k| scope.spawn(move || job(k))).collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        })
    }
}

/// One image of the sheet.
pub struct Entry {
    /// File name (without `.png`).
    pub key: String,
    /// Caption.
    pub label: String,
    /// Particles of the liquid.
    pub particles: usize,
    /// Simulated seconds.
    pub simulated: f32,
    /// Wall-clock seconds the simulation took.
    pub simulation_seconds: f64,
    /// The volume of the rendered surface over the poured volume.
    pub volume: f64,
    /// Samples per pixel.
    pub samples: u32,
    /// Render seconds.
    pub seconds: f64,
    /// Mean luminance of the image.
    pub mean: f64,
}

/// Renders the sheet; one entry per image.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    threads: usize,
) -> Result<Vec<Entry>, String> {
    let images = dir.join("liquid");
    std::fs::create_dir_all(&images).map_err(|e| format!("{}: {e}", images.display()))?;
    let poured = 40.0f64 * 40.0 * 55.0;
    let mut entries = Vec::new();
    let mut shots: Vec<(String, String, &'static str, u32, bool)> = presets()
        .iter()
        .map(|p| {
            (
                p.key.to_lowercase(),
                p.label.to_string(),
                p.key,
                STEPS,
                true,
            )
        })
        .collect();
    shots.push((
        "water-pouring".into(),
        "Water, a quarter of a second into the pour".into(),
        "WATER",
        60,
        true,
    ));
    shots.push((
        "water-plain".into(),
        "Water without priorities: its contact with the glass as against air".into(),
        "WATER",
        STEPS,
        false,
    ));
    let all = presets();
    for (file, label, key, steps, nested) in shots {
        let preset = all.iter().find(|p| p.key == key).expect("a preset");
        let spec = pour(preset.params);
        let mut world = LiquidWorld::new(&spec);
        world.set_workers(threads.max(1));
        let begun = Instant::now();
        world.step_with(steps, &Threads);
        let simulation_seconds = begun.elapsed().as_secs_f64();
        let volume = world.surface(0).volume() / poured;
        let mut scene = render_scene(
            &spec,
            &world,
            glass_material(),
            std::slice::from_ref(&preset.look),
            camera(),
            size.0,
            size.1,
        );
        scene.render.max_depth = 24;
        // The engine's own denoiser, as the render's *Denoise* (the glass's caustics on the floor are
        // slow to converge; the liquid is what the sheet is for).
        scene.render.denoise |= DENOISE_IMAGE;
        if !nested {
            scene.priorities.clear();
        }
        let out = render_progressive(&scene, samples, threads, None);
        let rgb8 = match out.denoised(threads) {
            Some(clean) => clean.to_srgb8_tonemapped(
                scene.render.exposure_ev,
                Tonemap::from_u32(scene.render.tonemap),
            ),
            None => out.to_rgb8(&scene),
        };
        let path = images.join(format!("{file}.png"));
        crate::write_png(&path, size.0, size.1, &rgb8)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        entries.push(Entry {
            key: file,
            label,
            particles: world.particle_count(),
            simulated: steps as f32 / 240.0,
            simulation_seconds,
            volume,
            samples: out.samples,
            seconds: out.elapsed.as_secs_f64(),
            mean: image_stats(&rgb8).mean_luminance,
        });
        let page = dir.join("liquid-sheet.html");
        std::fs::write(&page, html(&entries, size, threads))
            .map_err(|e| format!("{}: {e}", page.display()))?;
    }
    Ok(entries)
}

/// The sheet as a self-contained page.
pub fn html(entries: &[Entry], size: (u32, u32), threads: usize) -> String {
    let mut s = String::new();
    s.push_str(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>Liquids sheet</title>\n<style>\n\
         :root { color-scheme: light dark; --bg: #f4f4f4; --fg: #1a1a1a; --muted: #666; }\n\
         @media (prefers-color-scheme: dark) { :root { --bg: #141414; --fg: #e8e8e8; --muted: #999; } }\n\
         body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg);\n\
                font: 14px/1.4 system-ui, sans-serif; }\n\
         h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }\n\
         p.meta { margin: 0 0 20px; color: var(--muted); max-width: 70em; }\n\
         .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }\n\
         figure { margin: 0; }\n img { width: 100%; height: auto; display: block; }\n\
         figcaption { margin-top: 6px; }\n\
         figcaption span { display: block; color: var(--muted); font-variant-numeric: tabular-nums; }\n\
         </style>\n</head>\n<body>\n<h1>Liquids (S7)</h1>\n",
    );
    let _ = writeln!(
        s,
        "<p class=\"meta\">Each liquid preset poured into the example glass: a block of 88 ml falls \
         into it from 44 mm above its bottom, simulated by position based fluids for two seconds \
         at a spacing of {SPACING} mm, and its surface rebuilt by marching cubes; rendered {}x{} \
         with the glass at priority 2 and the liquid at 1 (nested dielectrics), filmic curve, \
         exposure 0, denoised by the engine's denoiser. Then water a quarter of a second into the \
         pour, and water at rest without the priorities. Each caption gives the particles, the \
         simulation's time on this machine ({threads} threads), the rendered surface's volume over \
         the poured volume and the render.</p>\n\
         <div class=\"grid\">",
        size.0, size.1
    );
    for e in entries {
        let _ = writeln!(
            s,
            "<figure><img src=\"liquid/{key}.png\" width=\"{w}\" height=\"{h}\" alt=\"{label}\">\
             <figcaption>{label}<span>{n} particles · {t:.2} s simulated in {sim:.1} s · surface \
             {vol:.3} of the poured volume</span><span>{spp} spp · {secs:.1} s · mean {mean:.3}</span>\
             </figcaption></figure>",
            key = e.key,
            w = size.0,
            h = size.1,
            label = e.label,
            n = e.particles,
            t = e.simulated,
            sim = e.simulation_seconds,
            vol = e.volume,
            spp = e.samples,
            secs = e.seconds,
            mean = e.mean
        );
    }
    s.push_str("</div>\n</body>\n</html>\n");
    s
}

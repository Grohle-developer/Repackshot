//! `rt --sheet <dir>`: the first contact sheet. The built-in example part (three instances)
//! rendered under six light recipes written here in Rust, with exposure statistics per image:
//! `<key>.png` per recipe, `index.html` (a grid) and `stats.json`; then the E5 scenes of
//! [`crate::scenes`] (glass, coat, anisotropy, an emitter, the sky and an HDRI), `e5-*.png`, at a
//! multiple of the samples, and the E5c skies (the physical sky against the classic one at
//! sunrise, golden hour, noon and in haze), `e5c-*.png`.
//!
//! These six recipes are engine test fixtures, not the catalogue's: the 16 x 12 sheet over the
//! studios and setups of `src/data/` comes in E4, when the TypeScript RSB writer exists. Their
//! placement follows the catalogue's convention (azimuth relative to the camera, 0 behind the
//! camera, negative to its left, 180 behind the part; elevation above the horizon) and their
//! powers are normalised so that the irradiance they send to the part adds up to
//! [`TOTAL_IRRADIANCE`], like the catalogue normalises a setup to its preset.

use crate::render_progressive;
use rt_core::color::Rgb;
use rt_core::fmath;
use rt_core::math::Vec3;
use rt_core::scene::{Light, LightKind, Scene, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY};
use std::fmt::Write as _;
use std::path::Path;

/// Default image size of the sheet.
pub const SHEET_SIZE: (u32, u32) = (480, 360);
/// Default samples per pixel of the sheet.
pub const SHEET_SAMPLES: u32 = 64;
/// Irradiance (W/m²) every recipe sends to the part, summed over its lights.
pub const TOTAL_IRRADIANCE: f32 = 2.5;

/// One light of a recipe, in photographer's terms.
#[derive(Clone, Debug, PartialEq)]
pub struct RecipeLight {
    /// Rect, disk or sun.
    pub kind: LightKind,
    /// Azimuth relative to the camera, degrees (0 behind the camera, 180 behind the part).
    pub azimuth: f32,
    /// Elevation above the horizon, degrees.
    pub elevation: f32,
    /// Distance from the part, millimetres (ignored for the sun).
    pub distance: f32,
    /// Width and height (rect) or diameter (disk), millimetres.
    pub size: (f32, f32),
    /// Fraction of [`TOTAL_IRRADIANCE`].
    pub share: f32,
    /// Beam spread, degrees.
    pub spread: f32,
    /// `LGHT.flags`.
    pub flags: u32,
}

impl RecipeLight {
    fn area(azimuth: f32, elevation: f32, distance: f32, size: (f32, f32), share: f32) -> Self {
        RecipeLight {
            kind: LightKind::Rect,
            azimuth,
            elevation,
            distance,
            size,
            share,
            spread: 180.0,
            flags: LIGHT_FLAG_GLOSSY,
        }
    }
}

/// A named set of lights.
#[derive(Clone, Debug, PartialEq)]
pub struct Recipe {
    /// File name stem and JSON key.
    pub key: &'static str,
    /// Caption.
    pub label: &'static str,
    /// The lights.
    pub lights: Vec<RecipeLight>,
}

/// The six recipes of the sheet.
pub fn recipes() -> Vec<Recipe> {
    let fill = |share| RecipeLight {
        flags: 0, // a fill that does not show in reflections
        ..RecipeLight::area(55.0, 15.0, 1300.0, (800.0, 800.0), share)
    };
    vec![
        Recipe {
            key: "key-only",
            label: "Key only",
            lights: vec![RecipeLight::area(-45.0, 35.0, 900.0, (500.0, 500.0), 1.0)],
        },
        Recipe {
            key: "three-point",
            label: "Three point",
            lights: vec![
                RecipeLight::area(-45.0, 30.0, 900.0, (500.0, 400.0), 0.55),
                fill(0.25),
                RecipeLight::area(160.0, 35.0, 900.0, (600.0, 120.0), 0.2),
            ],
        },
        Recipe {
            key: "split",
            label: "Split",
            lights: vec![RecipeLight {
                spread: 90.0,
                ..RecipeLight::area(-90.0, 10.0, 800.0, (250.0, 600.0), 1.0)
            }],
        },
        Recipe {
            key: "backlit-panel",
            label: "Backlit panel (camera-visible)",
            lights: vec![
                RecipeLight {
                    flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
                    ..RecipeLight::area(180.0, 8.0, 1000.0, (1600.0, 1000.0), 0.8)
                },
                RecipeLight {
                    flags: 0,
                    ..RecipeLight::area(15.0, 20.0, 1300.0, (600.0, 600.0), 0.2)
                },
            ],
        },
        Recipe {
            key: "overhead",
            label: "Overhead",
            lights: vec![RecipeLight::area(0.0, 85.0, 900.0, (1000.0, 1000.0), 1.0)],
        },
        Recipe {
            key: "sun",
            label: "Sun",
            lights: vec![RecipeLight {
                kind: LightKind::Sun,
                size: (0.0, 0.0),
                ..RecipeLight::area(-60.0, 40.0, 0.0, (0.0, 0.0), 1.0)
            }],
        },
    ]
}

/// Direction from the part towards `(azimuth, elevation)` in world space (Z up, azimuth 0 at
/// -Y), for a camera-relative azimuth around a camera at world azimuth `camera_azimuth`.
fn direction(camera_azimuth: f32, azimuth: f32, elevation: f32) -> Vec3 {
    let (sa, ca) = fmath::sin_cos((camera_azimuth + azimuth) * fmath::DEG_TO_RAD);
    let (se, ce) = fmath::sin_cos(elevation * fmath::DEG_TO_RAD);
    Vec3::new(ce * sa, -ce * ca, se)
}

/// The example scene lit by `recipe` instead of its own light.
pub fn scene_for(recipe: &Recipe, size: (u32, u32)) -> Scene {
    let mut scene = rt_core::example::scene();
    scene.render.width = size.0;
    scene.render.height = size.1;
    let target = scene.camera.target;
    let view = scene.camera.position - target;
    let camera_azimuth = fmath::atan2(view.x, -view.y) / fmath::DEG_TO_RAD;
    scene.lights = recipe
        .lights
        .iter()
        .map(|l| {
            let towards = direction(camera_azimuth, l.azimuth, l.elevation);
            let irradiance = TOTAL_IRRADIANCE * l.share;
            let (position, power) = if l.kind == LightKind::Sun {
                (target, irradiance)
            } else {
                // On-axis irradiance of a small Lambertian source of flux Φ at distance d is
                // about Φ / (π d²).
                let d = l.distance * 1.0e-3;
                (
                    target + towards * l.distance,
                    irradiance * fmath::PI * d * d,
                )
            };
            Light {
                kind: l.kind,
                position,
                direction: -towards,
                up: Vec3::new(0.0, 0.0, 1.0),
                size_x: l.size.0,
                size_y: l.size.1,
                color: Rgb::WHITE,
                power,
                spread_deg: l.spread,
                angle_deg: 0.53,
                flags: l.flags,
            }
        })
        .collect();
    scene
}

/// Exposure statistics of an 8-bit sRGB image.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ImageStats {
    /// Mean Rec. 709 luma of the encoded values, in `[0, 1]`.
    pub mean_luminance: f64,
    /// Fraction of pixels with a channel at 255.
    pub clipped_white: f64,
    /// Fraction of pixels with every channel at 2 or below.
    pub crushed_black: f64,
}

/// Statistics of `rgb8` (three bytes per pixel).
pub fn image_stats(rgb8: &[u8]) -> ImageStats {
    let pixels = (rgb8.len() / 3).max(1) as f64;
    let (mut luma, mut clipped, mut crushed) = (0.0f64, 0usize, 0usize);
    for p in rgb8.chunks_exact(3) {
        let (r, g, b) = (f64::from(p[0]), f64::from(p[1]), f64::from(p[2]));
        luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
        clipped += usize::from(p.contains(&255));
        crushed += usize::from(p.iter().all(|&c| c <= 2));
    }
    ImageStats {
        mean_luminance: luma / pixels,
        clipped_white: clipped as f64 / pixels,
        crushed_black: crushed as f64 / pixels,
    }
}

/// One rendered image of the sheet.
#[derive(Clone, Debug, PartialEq)]
pub struct SheetEntry {
    /// Recipe key.
    pub key: &'static str,
    /// Recipe caption.
    pub label: &'static str,
    /// PNG file name inside the sheet directory.
    pub file: String,
    /// Exposure statistics.
    pub stats: ImageStats,
    /// Samples per pixel rendered.
    pub samples: u32,
    /// Rays cast.
    pub rays: u64,
    /// Render time in seconds.
    pub seconds: f64,
}

/// Renders every recipe into `dir` and writes `index.html` and `stats.json` there.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    threads: usize,
) -> Result<Vec<SheetEntry>, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut entries = Vec::new();
    for recipe in recipes() {
        let scene = scene_for(&recipe, size);
        let out = render_progressive(&scene, samples, threads, None);
        let rgb8 = out.to_rgb8(&scene);
        let file = format!("{}.png", recipe.key);
        let path = dir.join(&file);
        crate::write_png(&path, size.0, size.1, &rgb8)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        entries.push(SheetEntry {
            key: recipe.key,
            label: recipe.label,
            file,
            stats: image_stats(&rgb8),
            samples: out.samples,
            rays: out.rays,
            seconds: out.elapsed.as_secs_f64(),
        });
    }
    for e5 in crate::scenes::e5_scenes(size) {
        let spp = samples.saturating_mul(e5.sample_factor.max(1));
        let out = render_progressive(&e5.scene, spp, threads, None);
        let rgb8 = out.to_rgb8(&e5.scene);
        let file = format!("{}.png", e5.key);
        let path = dir.join(&file);
        crate::write_png(&path, size.0, size.1, &rgb8)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        entries.push(SheetEntry {
            key: e5.key,
            label: e5.label,
            file,
            stats: image_stats(&rgb8),
            samples: out.samples,
            rays: out.rays,
            seconds: out.elapsed.as_secs_f64(),
        });
    }
    // E5b-1: caustics without and with photons, and the denoiser at few samples.
    for e in crate::scenes::e5b_scenes(size) {
        let spp = if e.low_samples {
            4
        } else {
            samples.saturating_mul(e.sample_factor.max(1))
        };
        let out = render_progressive(&e.scene, spp, threads, None);
        let rgb8 = match (e.denoise, out.denoised(threads)) {
            (true, Some(clean)) => clean.to_srgb8_tonemapped(
                e.scene.render.exposure_ev,
                rt_core::color::Tonemap::from_u32(e.scene.render.tonemap),
            ),
            _ => out.to_rgb8(&e.scene),
        };
        let file = format!("{}.png", e.key);
        let path = dir.join(&file);
        crate::write_png(&path, size.0, size.1, &rgb8)
            .map_err(|err| format!("{}: {err}", path.display()))?;
        entries.push(SheetEntry {
            key: e.key,
            label: e.label,
            file,
            stats: image_stats(&rgb8),
            samples: out.samples,
            rays: out.rays,
            seconds: out.elapsed.as_secs_f64(),
        });
    }
    let html_path = dir.join("index.html");
    std::fs::write(&html_path, html(&entries, size))
        .map_err(|e| format!("{}: {e}", html_path.display()))?;
    let json_path = dir.join("stats.json");
    std::fs::write(&json_path, json(&entries, size))
        .map_err(|e| format!("{}: {e}", json_path.display()))?;
    Ok(entries)
}

/// The sheet as a self-contained HTML page (a grid of images with their statistics).
pub fn html(entries: &[SheetEntry], size: (u32, u32)) -> String {
    let mut s = String::new();
    s.push_str(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>Engine contact sheet</title>\n<style>\n\
         :root { color-scheme: light dark; --bg: #f4f4f4; --fg: #1a1a1a; --muted: #666; }\n\
         @media (prefers-color-scheme: dark) { :root { --bg: #141414; --fg: #e8e8e8; --muted: #999; } }\n\
         body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg);\n\
                font: 14px/1.4 system-ui, sans-serif; }\n\
         h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }\n\
         p.meta { margin: 0 0 20px; color: var(--muted); }\n\
         .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }\n\
         figure { margin: 0; }\n\
         img { width: 100%; height: auto; display: block; }\n\
         figcaption { margin-top: 6px; }\n\
         figcaption b { font-weight: 600; }\n\
         figcaption span { display: block; color: var(--muted); font-variant-numeric: tabular-nums; }\n\
         </style>\n</head>\n<body>\n<h1>Engine contact sheet</h1>\n",
    );
    let samples = entries.first().map_or(0, |e| e.samples);
    let _ = writeln!(
        s,
        "<p class=\"meta\">The example part under six built-in recipes, {}x{}, {} spp, \
         {:.1} W/m² per recipe, then the E5 scenes (glass, coat, emitter, sky, HDRI) at more \
         samples and the E5c skies (physical against classic). Mean is the mean luma of the encoded image; clipped is the share of pixels \
         with a channel at 255; crushed the share with every channel at 2 or below.</p>\n\
         <div class=\"grid\">",
        size.0, size.1, samples, TOTAL_IRRADIANCE
    );
    for e in entries {
        let _ = writeln!(
            s,
            "<figure><img src=\"{file}\" width=\"{w}\" height=\"{h}\" alt=\"{label}\">\
             <figcaption><b>{label}</b><span>mean {mean:.3} · clipped {clip:.2} % · \
             crushed {crush:.2} % · {secs:.1} s</span></figcaption></figure>",
            file = e.file,
            w = size.0,
            h = size.1,
            label = e.label,
            mean = e.stats.mean_luminance,
            clip = 100.0 * e.stats.clipped_white,
            crush = 100.0 * e.stats.crushed_black,
            secs = e.seconds,
        );
    }
    s.push_str("</div>\n</body>\n</html>\n");
    s
}

/// The sheet's statistics as JSON.
pub fn json(entries: &[SheetEntry], size: (u32, u32)) -> String {
    let mut s = String::new();
    let _ = write!(
        s,
        "{{\n  \"width\": {},\n  \"height\": {},\n  \"total_irradiance\": {},\n  \"images\": [",
        size.0, size.1, TOTAL_IRRADIANCE
    );
    for (i, e) in entries.iter().enumerate() {
        let _ = write!(
            s,
            "{}\n    {{ \"recipe\": \"{}\", \"label\": \"{}\", \"file\": \"{}\", \
             \"mean_luminance\": {:.5}, \"clipped_white\": {:.5}, \"crushed_black\": {:.5}, \
             \"samples\": {}, \"rays\": {}, \"seconds\": {:.3} }}",
            if i == 0 { "" } else { "," },
            e.key,
            e.label,
            e.file,
            e.stats.mean_luminance,
            e.stats.clipped_white,
            e.stats.crushed_black,
            e.samples,
            e.rays,
            e.seconds
        );
    }
    s.push_str("\n  ]\n}\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_count_clipped_and_crushed_pixels() {
        let img = [255, 0, 0, 0, 0, 0, 2, 1, 0, 128, 128, 128];
        let s = image_stats(&img);
        assert_eq!(s.clipped_white, 0.25);
        assert_eq!(s.crushed_black, 0.5);
        let mean = (0.2126 * 255.0 + 0.2126 * 2.0 + 0.7152 + 128.0) / 255.0 / 4.0;
        assert!((s.mean_luminance - mean).abs() < 1.0e-9);
    }

    #[test]
    fn recipes_are_normalised_and_placed_around_the_part() {
        let all = recipes();
        assert_eq!(all.len(), 6);
        for r in &all {
            let share: f32 = r.lights.iter().map(|l| l.share).sum();
            assert!((share - 1.0).abs() < 1.0e-6, "{}", r.key);
            let scene = scene_for(r, (48, 36));
            assert_eq!(scene.lights.len(), r.lights.len());
            for light in &scene.lights {
                // Every light points at the part.
                if light.kind != LightKind::Sun {
                    let to_target = (scene.camera.target - light.position).normalize();
                    assert!(to_target.dot(light.direction) > 0.999);
                }
                assert!(light.power > 0.0);
            }
        }
        // The key-only light is camera left: on the -X side of the camera's right axis.
        let key = scene_for(&all[0], (48, 36));
        let (_, right, _) = key.camera.basis();
        assert!((key.lights[0].position - key.camera.target).dot(right) < 0.0);
        // Exactly one light, the backlit panel, is visible to the camera.
        let visible: Vec<&str> = all
            .iter()
            .flat_map(|r| r.lights.iter().map(move |l| (r.key, l.flags)))
            .filter(|(_, flags)| flags & LIGHT_FLAG_CAMERA != 0)
            .map(|(key, _)| key)
            .collect();
        assert_eq!(visible, ["backlit-panel"]);
    }

    #[test]
    fn html_and_json_list_every_image() {
        let entries: Vec<SheetEntry> = recipes()
            .iter()
            .map(|r| SheetEntry {
                key: r.key,
                label: r.label,
                file: format!("{}.png", r.key),
                stats: ImageStats {
                    mean_luminance: 0.4,
                    clipped_white: 0.01,
                    crushed_black: 0.0,
                },
                samples: 4,
                rays: 100,
                seconds: 0.5,
            })
            .collect();
        let html = html(&entries, (48, 36));
        let json = json(&entries, (48, 36));
        for e in &entries {
            assert!(html.contains(&format!("src=\"{}\"", e.file)));
            assert!(json.contains(&format!("\"recipe\": \"{}\"", e.key)));
        }
        assert!(html.starts_with("<!doctype html>") && html.contains("<title>"));
        assert_eq!(json.matches("\"mean_luminance\"").count(), 6);
        assert!(json.trim_end().ends_with('}'));
    }
}

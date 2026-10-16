//! `rt --e13-sheet <dir>`: the E13 contact sheet of manifold next-event estimation. Four
//! scenes, each rendered by the engine of before E13 (the connections off, which renders exactly
//! what v0.1.12 rendered: a test pins it), with the connections, and as the reference of both (the
//! connections and the E9b thin-wall rule off: light reaches what is behind glass only by the
//! paths that refract onto a light, unbiased and noisy, at many samples):
//!
//! * the perfume bottle of E9b filled with milk ([`crate::sss_sheet::bottle`]): the milk's exit
//!   vertices connect to the lights through the bottle's 3 mm wall;
//! * a glass of water under a small light ([`crate::scenes::water_glass`]), and the glass ball of
//!   E5b-1 ([`crate::scenes::caustic_sphere`]): their caustics on the floor by the connections and
//!   by the photon map;
//! * the perfume bottle of E5 ([`crate::scenes::glass_bottle`]), whose cost the phase bounds.
//!
//! With the time, the rays per camera sample and, over a region of each image (the milk, the
//! caustic, the floor beside the bottle), the mean against the reference's, the relative mean
//! squared error against it and the relative noise (two renders of different seeds). Writes
//! `<dir>/e13-sheet.html`, the PNGs and `sheet.json` into `<dir>/e13/`, and each scene as an RSB
//! file there (for `tools/e13-cost.mjs`).

use crate::photon_maps;
use crate::scenes::{caustic_sphere, glass_bottle, water_glass, SHEET_CAUSTIC_PHOTONS};
use crate::sss_sheet::{bottle, recipes};
use rt_core::image::Film;
use rt_core::integrator::Prepared;
use rt_core::math::Ray;
use rt_core::render::{centre_ray, render_tile_photons, tile_grid};
use rt_core::scene::Scene;
use rt_core::simd::Isa;
use std::fmt::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Instant;

/// Default image size.
pub const SIZE: (u32, u32) = (320, 240);
/// Default samples per pixel of the images compared.
pub const SAMPLES: u32 = 64;
/// Samples per pixel of the references, per sample of the images compared (2048 by default).
pub const REFERENCE_FACTOR: u32 = 32;

/// How a scene is rendered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The engine of before E13: no connections (the thin-wall rule of E9b on).
    Before,
    /// With the connections of E13.
    After,
    /// Neither the connections nor the thin-wall rule.
    Reference,
}

impl Mode {
    fn key(self) -> &'static str {
        match self {
            Mode::Before => "before",
            Mode::After => "after",
            Mode::Reference => "reference",
        }
    }
}

/// A rendered image.
pub struct Rendered {
    /// The film.
    pub film: Film,
    /// Rays cast, photons included.
    pub rays: u64,
    /// Wall-clock seconds.
    pub seconds: f64,
}

/// Renders samples `0..spp` of `scene` in `mode` on `threads` threads (32-pixel tiles, each
/// sample's photon map first when the scene has caustics).
pub fn render_mode(scene: &Scene, mode: Mode, spp: u32, threads: usize) -> Rendered {
    let start = Instant::now();
    let mut prepared = Prepared::new(scene);
    if mode != Mode::After {
        prepared.set_manifold(false);
    }
    if mode == Mode::Reference {
        prepared.set_thin_wall_rule(false);
    }
    let isa = Isa::detect();
    let (w, h) = (scene.render.width, scene.render.height);
    let tiles = tile_grid(w, h, 32);
    let films: Vec<Mutex<Film>> = tiles
        .iter()
        .map(|t| Mutex::new(Film::region(t.x, t.y, t.w, t.h)))
        .collect();
    let threads = threads.clamp(1, tiles.len().max(1));
    let mut rays = 0u64;
    for sample in 0..spp {
        let (maps, map_rays) = photon_maps(scene, &prepared, sample, 1, threads, isa);
        rays += map_rays;
        let (map, prepared) = (maps.first(), &prepared);
        let next = AtomicUsize::new(0);
        rays += std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|_| {
                    scope.spawn(|| {
                        let mut rays = 0u64;
                        while let (Some(&tile), Some(film)) = {
                            let i = next.fetch_add(1, Ordering::Relaxed);
                            (tiles.get(i), films.get(i))
                        } {
                            let mut film = film.lock().unwrap_or_else(PoisonError::into_inner);
                            rays += render_tile_photons(
                                scene, prepared, map, tile, sample, &mut film, isa,
                            );
                        }
                        rays
                    })
                })
                .collect();
            workers
                .into_iter()
                .map(|w| {
                    w.join()
                        .unwrap_or_else(|payload| std::panic::resume_unwind(payload))
                })
                .sum::<u64>()
        });
    }
    let mut film = Film::new(w, h);
    for f in films {
        film.copy_region(&f.into_inner().unwrap_or_else(PoisonError::into_inner));
    }
    Rendered {
        film,
        rays,
        seconds: start.elapsed().as_secs_f64(),
    }
}

/// Where `ray` meets the vertical cylinder of radius `r` about the Z axis between `z0` and `z1`
/// (its side only), if it does.
fn meets_cylinder(ray: &Ray, r: f32, z0: f32, z1: f32) -> bool {
    let (o, d) = (ray.origin, ray.dir);
    let a = d.x * d.x + d.y * d.y;
    let b = o.x * d.x + o.y * d.y;
    let c = o.x * o.x + o.y * o.y - r * r;
    let disc = b * b - a * c;
    if a <= 0.0 || disc < 0.0 {
        return false;
    }
    let t = (-b - disc.sqrt()) / a;
    let z = o.z + d.z * t;
    t > 0.0 && (z0..=z1).contains(&z)
}

/// The pixels whose centre ray sees the floor first, at a distance from the Z axis in `radii`.
fn floor_pixels(scene: &Scene, radii: (f32, f32)) -> Vec<usize> {
    let (w, h) = (scene.render.width, scene.render.height);
    (0..w * h)
        .filter(|&i| {
            let ray = centre_ray(scene, i % w, i / w);
            if ray.dir.z >= 0.0 {
                return false;
            }
            let t = (scene.floor.z - ray.origin.z) / ray.dir.z;
            let p = ray.at(t);
            let r = (p.x * p.x + p.y * p.y).sqrt();
            let first = scene.geometry.trace(&ray).is_none_or(|hit| hit.t > t);
            first && r >= radii.0 && r <= radii.1
        })
        .map(|i| i as usize)
        .collect()
}

/// The pixels whose centre ray, straight, crosses the milk well inside its glass (the wall is
/// thin and nearly parallel, so refraction moves this region by less than its margin).
fn milk_pixels(scene: &Scene) -> Vec<usize> {
    let (w, h) = (scene.render.width, scene.render.height);
    (0..w * h)
        .filter(|&i| meets_cylinder(&centre_ray(scene, i % w, i / w), 28.0, 14.0, 54.0))
        .map(|i| i as usize)
        .collect()
}

/// The green channel of a film, per pixel.
fn green(film: &Film) -> Vec<f64> {
    film.resolve()
        .iter()
        .skip(1)
        .step_by(3)
        .map(|&v| f64::from(v))
        .collect()
}

/// The pixels of `floor` (floor pixels) where the reference is more than twice the median of
/// them: the caustic.
fn caustic_pixels(reference: &[f64], floor: &[usize]) -> Vec<usize> {
    let mut values: Vec<f64> = floor.iter().map(|&i| reference[i]).collect();
    values.sort_by(f64::total_cmp);
    let median = values.get(values.len() / 2).copied().unwrap_or(0.0);
    floor
        .iter()
        .copied()
        .filter(|&i| reference[i] > 2.0 * median)
        .collect()
}

fn mean(img: &[f64], region: &[usize]) -> f64 {
    region.iter().map(|&i| img[i]).sum::<f64>() / region.len().max(1) as f64
}

/// The relative mean squared error of `img` against `reference` over `region`:
/// `(x − r)² / (r² + 0.01)`, averaged (E5b-1's measure).
fn rel_mse(img: &[f64], reference: &[f64], region: &[usize]) -> f64 {
    region
        .iter()
        .map(|&i| {
            let (x, r) = (img[i], reference[i]);
            (x - r) * (x - r) / (r * r + 0.01)
        })
        .sum::<f64>()
        / region.len().max(1) as f64
}

/// The relative noise of two independent renders `a` and `b` over `region`: the standard
/// deviation of one pixel, `√(Σ (a − b)² / 2n)`, over the region's mean.
fn noise(a: &[f64], b: &[f64], region: &[usize]) -> f64 {
    let n = region.len().max(1) as f64;
    let var = region
        .iter()
        .map(|&i| (a[i] - b[i]) * (a[i] - b[i]) / 2.0)
        .sum::<f64>()
        / n;
    let m = region.iter().map(|&i| a[i] + b[i]).sum::<f64>() / (2.0 * n);
    var.sqrt() / m.max(1.0e-12)
}

/// One image of the sheet and its numbers.
pub struct Shot {
    /// File stem.
    pub key: String,
    /// Caption.
    pub label: String,
    /// Samples per pixel.
    pub samples: u32,
    /// Render time, seconds.
    pub seconds: f64,
    /// Rays per camera sample.
    pub rays_per_sample: f64,
    /// Over the scene's region: mean against the reference's, relative MSE against it and the
    /// relative noise (`None` for the reference itself, or where not measured).
    pub ratio: Option<f64>,
    pub rel_mse: Option<f64>,
    pub noise: Option<f64>,
}

/// One scene of the sheet.
struct Row {
    key: &'static str,
    title: &'static str,
    note: String,
    region: &'static str,
    shots: Vec<Shot>,
}

/// What a scene's region is.
enum Region {
    Milk,
    Caustic,
    Floor((f32, f32)),
}

/// Renders the sheet into `dir`: images at `samples` per pixel, references at `reference`, on
/// `threads` threads, `size` pixels.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    reference: u32,
    threads: usize,
) -> Result<(), String> {
    let images = dir.join("e13");
    std::fs::create_dir_all(&images).map_err(|e| format!("{}: {e}", images.display()))?;
    let milk = recipes()
        .into_iter()
        .find(|r| r.key == "MILK")
        .map(|r| r.material)
        .unwrap_or_default();
    // (key, title, scene, region, the scene with photons, if compared)
    let scenes: Vec<(&str, &str, Scene, Region, Option<Scene>)> = vec![
        (
            "milk-bottle",
            "The perfume bottle of E9b filled with milk",
            bottle(size, milk),
            Region::Milk,
            None,
        ),
        (
            "water-glass",
            "A glass of water under a small light",
            water_glass(size, 0),
            Region::Caustic,
            Some(water_glass(size, SHEET_CAUSTIC_PHOTONS)),
        ),
        (
            "glass-ball",
            "The glass ball of E5b-1 under a small light",
            caustic_sphere(size, 0),
            Region::Caustic,
            Some(caustic_sphere(size, SHEET_CAUSTIC_PHOTONS)),
        ),
        (
            "e5-bottle",
            "The perfume bottle of E5 (the phase's cost bound)",
            glass_bottle(size),
            Region::Floor((40.0, 160.0)),
            None,
        ),
    ];
    let mut rows = Vec::new();
    let mut json = String::from("{\n  \"scenes\": [\n");
    for (n, (key, title, scene, region, lit)) in scenes.into_iter().enumerate() {
        let mut scene = scene;
        scene.render.width = size.0;
        scene.render.height = size.1;
        let rsb = images.join(format!("{key}.rsb"));
        std::fs::write(&rsb, scene.to_rsb()).map_err(|e| format!("{}: {e}", rsb.display()))?;
        let refd = render_mode(&scene, Mode::Reference, reference, threads);
        let ref_green = green(&refd.film);
        let pixels = match region {
            Region::Milk => milk_pixels(&scene),
            Region::Caustic => caustic_pixels(&ref_green, &floor_pixels(&scene, (0.0, 1.0e9))),
            Region::Floor(radii) => floor_pixels(&scene, radii),
        };
        let region_words = match region {
            Region::Milk => "the milk",
            Region::Caustic => "the caustic (floor pixels at more than twice the median floor)",
            Region::Floor(_) => "the floor around the bottle",
        };
        let camera_samples = |spp: u32| f64::from(size.0) * f64::from(size.1) * f64::from(spp);
        let write = |file: &str, r: &Rendered, s: &Scene| -> Result<(), String> {
            let rgb8 = r
                .film
                .to_srgb8_tonemapped(s.render.exposure_ev, tone(s.render.tonemap));
            let path = images.join(file);
            crate::write_png(&path, size.0, size.1, &rgb8)
                .map_err(|e| format!("{}: {e}", path.display()))
        };
        let mut shots = Vec::new();
        let measured = |label: &str, mode: Mode, s: &Scene| -> Result<Shot, String> {
            let a = render_mode(s, mode, samples, threads);
            let mut seeded = s.clone();
            seeded.render.seed = seeded.render.seed.wrapping_add(1000);
            let b = render_mode(&seeded, mode, samples, threads);
            let (ga, gb) = (green(&a.film), green(&b.film));
            let suffix = if s.render.caustic_photons > 0 {
                "-photons"
            } else {
                ""
            };
            let stem = format!("{key}-{}{suffix}", mode.key());
            write(&format!("{stem}.png"), &a, s)?;
            Ok(Shot {
                key: stem,
                label: label.into(),
                samples,
                seconds: a.seconds,
                rays_per_sample: a.rays as f64 / camera_samples(samples),
                ratio: Some(mean(&ga, &pixels) / mean(&ref_green, &pixels).max(1.0e-12)),
                rel_mse: Some(rel_mse(&ga, &ref_green, &pixels)),
                noise: Some(noise(&ga, &gb, &pixels)),
            })
        };
        shots.push(measured(
            "Before E13 (no connections)",
            Mode::Before,
            &scene,
        )?);
        shots.push(measured("E13: manifold connections", Mode::After, &scene)?);
        if let Some(lit) = &lit {
            let mut lit = lit.clone();
            lit.render.width = size.0;
            lit.render.height = size.1;
            shots.push(measured("Photon map (caustics on)", Mode::After, &lit)?);
        }
        write(&format!("{key}-reference.png"), &refd, &scene)?;
        shots.push(Shot {
            key: format!("{key}-reference"),
            label: "Reference (neither connections nor the thin-wall rule)".into(),
            samples: reference,
            seconds: refd.seconds,
            rays_per_sample: refd.rays as f64 / camera_samples(reference),
            ratio: None,
            rel_mse: None,
            noise: None,
        });
        // The milk's grain against the floor's, in the same image.
        let note = if matches!(region, Region::Milk) {
            let floor = floor_pixels(&scene, (45.0, 140.0));
            let after = |seed: u32| {
                let mut s = scene.clone();
                s.render.seed = s.render.seed.wrapping_add(seed);
                green(&render_mode(&s, Mode::After, samples, threads).film)
            };
            let (a, b) = (after(0), after(1000));
            format!(
                "Relative noise at {samples} spp with the connections: milk {:.4}, floor beside the bottle {:.4}.",
                noise(&a, &b, &pixels),
                noise(&a, &b, &floor)
            )
        } else {
            String::new()
        };
        let _ = write!(
            json,
            "{}    {{ \"key\": \"{key}\", \"region_pixels\": {}, \"shots\": [",
            if n > 0 { ",\n" } else { "" },
            pixels.len()
        );
        for (k, s) in shots.iter().enumerate() {
            let num = |v: Option<f64>| v.map_or("null".to_string(), |v| format!("{v:.6}"));
            let _ = write!(
                json,
                "{}{{ \"key\": \"{}\", \"samples\": {}, \"seconds\": {:.3}, \"rays_per_sample\": {:.3}, \"ratio\": {}, \"rel_mse\": {}, \"noise\": {} }}",
                if k > 0 { ", " } else { "" },
                s.key,
                s.samples,
                s.seconds,
                s.rays_per_sample,
                num(s.ratio),
                num(s.rel_mse),
                num(s.noise)
            );
        }
        json.push_str("] }");
        for s in &shots {
            println!(
                "{:<32} {:>5} spp {:>8.1} s {:>6.1} rays/sample  ratio {}  relMSE {}  noise {}",
                s.key,
                s.samples,
                s.seconds,
                s.rays_per_sample,
                s.ratio.map_or("-".into(), |v| format!("{v:.4}")),
                s.rel_mse.map_or("-".into(), |v| format!("{v:.5}")),
                s.noise.map_or("-".into(), |v| format!("{v:.4}"))
            );
        }
        if !note.is_empty() {
            println!("{note}");
        }
        rows.push(Row {
            key,
            title,
            note,
            region: region_words,
            shots,
        });
        let page = dir.join("e13-sheet.html");
        std::fs::write(&page, html(&rows, size)).map_err(|e| format!("{}: {e}", page.display()))?;
    }
    json.push_str("\n  ]\n}\n");
    let path = images.join("sheet.json");
    std::fs::write(&path, json).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(())
}

fn tone(code: u32) -> rt_core::color::Tonemap {
    rt_core::color::Tonemap::from_u32(code)
}

/// The sheet as a self-contained page.
fn html(rows: &[Row], size: (u32, u32)) -> String {
    let mut s = String::new();
    s.push_str(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>Manifold connections sheet</title>\n<style>\n\
         :root { color-scheme: light dark; --bg: #f4f4f4; --fg: #1a1a1a; --muted: #666; --line: #ccc; }\n\
         @media (prefers-color-scheme: dark) { :root { --bg: #141414; --fg: #e8e8e8; --muted: #999; --line: #333; } }\n\
         body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg);\n\
                font: 14px/1.4 system-ui, sans-serif; }\n\
         h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }\n\
         h2 { font-size: 15px; font-weight: 600; margin: 28px 0 4px; }\n\
         p { margin: 0 0 12px; color: var(--muted); max-width: 72em; }\n\
         .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }\n\
         figure { margin: 0; }\n img { width: 100%; height: auto; display: block; image-rendering: auto; }\n\
         figcaption { margin-top: 6px; }\n\
         figcaption span { display: block; color: var(--muted); font-variant-numeric: tabular-nums; }\n\
         </style>\n</head>\n<body>\n<h1>Manifold next-event estimation (E13)</h1>\n",
    );
    let _ = writeln!(
        s,
        "<p>Each scene before E13 (no connections: what v0.1.12 renders), with the connections, \
         with the photon map where the scene has caustics, and the reference (neither the \
         connections nor the thin-wall rule of E9b: light behind glass only by the paths that \
         refract onto a light), {}x{}. Over each scene's region: the mean against the \
         reference's, the relative mean squared error against it and the relative noise of one \
         pixel (two renders of different seeds). Time on a shared machine; rays per camera \
         sample do not depend on its load. Filmic or standard curve as the scene says, exposure \
         0.</p>",
        size.0, size.1
    );
    for row in rows {
        let _ = writeln!(s, "<h2 id=\"{}\">{}</h2>", row.key, row.title);
        let _ = writeln!(
            s,
            "<p>Region: {}. {}</p>\n<div class=\"grid\">",
            row.region, row.note
        );
        for shot in &row.shots {
            let numbers = match (shot.ratio, shot.rel_mse, shot.noise) {
                (Some(r), Some(m), Some(n)) => {
                    format!(" · mean {r:.3} of the reference · relMSE {m:.4} · noise {n:.3}")
                }
                _ => String::new(),
            };
            let _ = writeln!(
                s,
                "<figure><img src=\"e13/{key}.png\" width=\"{w}\" height=\"{h}\" alt=\"{label}\">\
                 <figcaption>{label}<span>{spp} spp · {secs:.1} s · {rays:.1} rays per sample{numbers}</span></figcaption></figure>",
                key = shot.key,
                w = size.0,
                h = size.1,
                label = shot.label,
                spp = shot.samples,
                secs = shot.seconds,
                rays = shot.rays_per_sample,
            );
        }
        let _ = writeln!(s, "</div>");
    }
    s.push_str("</body>\n</html>\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_scenes_have_their_regions() {
        let size = (64, 48);
        let milk = recipes()
            .into_iter()
            .find(|r| r.key == "MILK")
            .map(|r| r.material)
            .expect("milk");
        let b = bottle(size, milk);
        assert!(milk_pixels(&b).len() > 50, "{}", milk_pixels(&b).len());
        assert!(floor_pixels(&b, (45.0, 140.0)).len() > 50);
        let w = water_glass(size, 0);
        assert!(Prepared::new(&w).has_manifold());
        assert_eq!(Scene::from_rsb(&w.to_rsb()).as_ref(), Ok(&w));
        let reference = vec![1.0; 64 * 48];
        assert!(caustic_pixels(&reference, &floor_pixels(&w, (0.0, 1.0e9))).is_empty());
        let r = render_mode(&w, Mode::After, 1, 2);
        assert!(r.rays > 0 && r.film.width == 64);
    }
}

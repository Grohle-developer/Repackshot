//! The measurement of E10's criterion (`rt --adaptive-noise <dir>`): on the scenes of the E5b-1
//! sheet (the key-only recipe on the example part, and the backlit glass bottle), the relative
//! mean squared error against a long uniform reference of an image rendered for the same time
//! uniformly and adaptively (`RNDR.adaptive`, no noise target: the samples only go elsewhere),
//! over a few rounds of different seeds. `noise.json` in the directory holds every render and
//! the ratios; the table is printed too.

use crate::{render_progressive, sheet, RenderOutput};
use rt_core::adaptive::ADAPTIVE_ON;
use rt_core::scene::Scene;
use std::fmt::Write as _;
use std::path::Path;
use std::time::Duration;

/// The scenes of the measurement at `size`: the key-only recipe of the sheet and the glass bottle.
pub fn scenes(size: (u32, u32)) -> Vec<(&'static str, Scene)> {
    let recipe = sheet::recipes()
        .into_iter()
        .find(|r| r.key == "key-only")
        .expect("the key-only recipe");
    vec![
        ("key-only", sheet::scene_for(&recipe, size)),
        ("glass-bottle", crate::scenes::glass_bottle(size)),
    ]
}

/// Relative mean squared error of `image` against `reference` (linear RGB, values clamped at 8 so
/// a firefly of the reference cannot dominate): the measure of E5b-1's criterion.
pub fn rel_mse(image: &[f32], reference: &[f32]) -> f64 {
    image
        .iter()
        .zip(reference)
        .map(|(&x, &r)| {
            let (x, r) = (f64::from(x.min(8.0)), f64::from(r.min(8.0)));
            (x - r) * (x - r) / (r * r + 1.0e-2)
        })
        .sum::<f64>()
        / image.len() as f64
}

/// One render of the measurement.
#[derive(Clone, Debug, PartialEq)]
pub struct NoiseRow {
    /// The scene's key.
    pub scene: &'static str,
    /// `uniform` or `adaptive`.
    pub mode: &'static str,
    /// The round (its seed is `1 + round`; the reference's is 1000).
    pub round: u32,
    /// Seconds it rendered.
    pub seconds: f64,
    /// The fewest and the most samples of a pixel.
    pub samples: (u32, u32),
    /// Rays cast.
    pub rays: u64,
    /// Its relative mean squared error against the reference.
    pub rel_mse: f64,
}

/// Renders `scene` with `seed` for `seconds` on `threads` threads, adaptively or not.
fn timed(scene: &Scene, seed: u32, adaptive: bool, seconds: f64, threads: usize) -> RenderOutput {
    let mut scene = scene.clone();
    scene.render.seed = seed;
    scene.render.adaptive = if adaptive { ADAPTIVE_ON } else { 0 };
    scene.render.noise_threshold = 0.0;
    render_progressive(
        &scene,
        1 << 24,
        threads,
        Some(Duration::from_secs_f64(seconds)),
    )
}

/// Runs the measurement: per scene a uniform reference of `reference` samples, then `rounds`
/// rounds of a uniform and an adaptive render of `seconds` each. Writes `noise.json` into `dir`
/// and returns the table.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    seconds: f64,
    reference: u32,
    rounds: u32,
    threads: usize,
) -> Result<String, String> {
    for (i, k) in ["RT_E10_KEY", "RT_E10_BLOCK", "RT_E10_Q", "RT_E10_EPS"].iter().enumerate() {
        if let Ok(v) = std::env::var(k) {
            rt_core::adaptive::EXP[i].store(v.parse().unwrap(), std::sync::atomic::Ordering::Relaxed);
        }
    }
    let mut rows = Vec::new();
    let mut refs = Vec::new();
    for (key, scene) in scenes(size) {
        let mut r = scene.clone();
        let cache = std::env::var("RT_E10_REFCACHE").ok().map(|d| {
            Path::new(&d).join(format!("{key}-{}x{}-{reference}.f32", size.0, size.1))
        });
        let load = |p: &Path| -> Option<(Vec<f32>, Vec<f32>)> {
            let b = std::fs::read(p).ok()?;
            let v: Vec<f32> = b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
            let h = v.len() / 2;
            Some((v[..h].to_vec(), v[h..].to_vec()))
        };
        let (reference_image, other_image, took) = match cache.as_deref().and_then(load) {
            Some((a, b)) => (a, b, 0.0),
            None => {
                r.render.seed = 1000;
                let long = render_progressive(&r, reference, threads, None);
                r.render.seed = 2000;
                let other = render_progressive(&r, reference, threads, None);
                let (a, b) = (long.film.resolve(), other.film.resolve());
                if let Some(p) = &cache {
                    let bytes: Vec<u8> = a.iter().chain(&b).flat_map(|v| v.to_le_bytes()).collect();
                    let _ = std::fs::write(p, bytes);
                }
                (a, b, long.elapsed.as_secs_f64())
            }
        };
        let own = rel_mse(&other_image, &reference_image) / 2.0;
        eprintln!("{key}: reference {reference} spp in {took:.1} s, its own relMSE {own:.8}");
        refs.push((key, took));
        for round in 0..rounds {
            let mut uniform_rays = 0u64;
            for adaptive in [false, true] {
                let out = if adaptive && std::env::var("RT_E10_WORK").is_ok() {
                    let mut s2 = scene.clone();
                    s2.render.seed = 1 + round;
                    s2.render.adaptive = ADAPTIVE_ON;
                    let stop = |rays: u64, _: Duration| rays >= uniform_rays;
                    crate::render_until(&s2, 1 << 24, threads, &stop)
                } else {
                    timed(&scene, 1 + round, adaptive, seconds, threads)
                };
                if !adaptive {
                    uniform_rays = out.rays;
                }
                if let Ok(d) = std::env::var("RT_E10_DUMP") {
                    let name = format!("{key}-{}-{round}", if adaptive { "a" } else { "u" });
                    let img: Vec<u8> = out.film.resolve().iter().chain(&out.film.weight).flat_map(|v| v.to_le_bytes()).collect();
                    let _ = std::fs::write(Path::new(&d).join(name), img);
                    let refb: Vec<u8> = reference_image.iter().flat_map(|v| v.to_le_bytes()).collect();
                    let _ = std::fs::write(Path::new(&d).join(format!("{key}-ref")), refb);
                }
                let samples = out.adaptive.map_or((out.samples, out.samples), |a| (a.min, a.max));
                let row = NoiseRow {
                    scene: key,
                    mode: if adaptive { "adaptive" } else { "uniform" },
                    round,
                    seconds: out.elapsed.as_secs_f64(),
                    samples,
                    rays: out.rays,
                    rel_mse: rel_mse(&out.film.resolve(), &reference_image),
                };
                eprintln!(
                    "{key} {} round {round}: {:.2} s, {}..{} spp, relMSE {:.6}",
                    row.mode, row.seconds, samples.0, samples.1, row.rel_mse
                );
                rows.push(row);
            }
        }
    }
    let table = table(&rows);
    let mut json = String::from("{\n");
    let _ = writeln!(
        json,
        "  \"size\": [{}, {}],\n  \"seconds\": {seconds},\n  \"referenceSamples\": {reference},\n  \"rounds\": {rounds},\n  \"threads\": {threads},",
        size.0, size.1
    );
    json.push_str("  \"references\": [");
    for (i, (key, s)) in refs.iter().enumerate() {
        let _ = write!(
            json,
            "{}{{\"scene\": \"{key}\", \"seconds\": {s:.3}}}",
            if i > 0 { ", " } else { "" }
        );
    }
    json.push_str("],\n  \"renders\": [\n");
    for (i, r) in rows.iter().enumerate() {
        let _ = writeln!(
            json,
            "    {{\"scene\": \"{}\", \"mode\": \"{}\", \"round\": {}, \"seconds\": {:.3}, \"samples\": [{}, {}], \"rays\": {}, \"relMse\": {:.8}}}{}",
            r.scene,
            r.mode,
            r.round,
            r.seconds,
            r.samples.0,
            r.samples.1,
            r.rays,
            r.rel_mse,
            if i + 1 < rows.len() { "," } else { "" }
        );
    }
    json.push_str("  ]\n}\n");
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("noise.json");
    std::fs::write(&path, json).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(table)
}

/// Per scene: the mean relative error of each mode, the same scaled to the uniform renders' mean
/// time (`relMSE × t / t̄`, since the error of a progressive render falls as 1/t), and the ratio
/// adaptive / uniform of both.
pub fn table(rows: &[NoiseRow]) -> String {
    let mut out = String::from(
        "scene         mode      seconds  samples      relMSE      relMSE at equal time\n",
    );
    let mut keys: Vec<&str> = rows.iter().map(|r| r.scene).collect();
    keys.dedup();
    for key in keys {
        let of = |mode: &str| -> Vec<&NoiseRow> {
            rows.iter()
                .filter(|r| r.scene == key && r.mode == mode)
                .collect()
        };
        let (u, a) = (of("uniform"), of("adaptive"));
        let mean = |v: &[&NoiseRow], f: &dyn Fn(&NoiseRow) -> f64| {
            v.iter().map(|r| f(r)).sum::<f64>() / v.len().max(1) as f64
        };
        let t = mean(&u, &|r| r.seconds);
        let mut line = |mode: &str, v: &[&NoiseRow]| -> (f64, f64) {
            let e = mean(v, &|r| r.rel_mse);
            let scaled = mean(v, &|r| r.rel_mse * r.seconds / t);
            let (lo, hi) = (
                v.iter().map(|r| r.samples.0).min().unwrap_or(0),
                v.iter().map(|r| r.samples.1).max().unwrap_or(0),
            );
            let _ = writeln!(
                out,
                "{key:<13} {mode:<9} {:>7.2}  {lo:>5}-{hi:<6} {e:>10.6}  {scaled:>10.6}",
                mean(v, &|r| r.seconds)
            );
            (e, scaled)
        };
        let (ue, us) = line("uniform", &u);
        let (ae, ascaled) = line("adaptive", &a);
        let _ = writeln!(
            out,
            "{key:<13} ratio                          {:>10.3}  {:>10.3}",
            ae / ue,
            ascaled / us
        );
    }
    out
}

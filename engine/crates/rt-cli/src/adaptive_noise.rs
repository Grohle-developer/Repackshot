//! The measurement of E10's criterion (`rt --adaptive-noise <dir>`): on the scenes of the E5b-1
//! sheet (the key-only recipe on the example part, and the backlit glass bottle), the relative
//! mean squared error against a long uniform reference of images rendered uniformly and
//! adaptively (`RNDR.adaptive`; with `--noise`, to that target, else the samples only go
//! elsewhere), over a few rounds of different seeds. Each round renders the uniform image for the
//! time budget, then the adaptive one for the same time, then the adaptive one again until it has
//! cast as many rays as the uniform one (a measure the machine's load does not move). The
//! references (two of them, of other seeds, so their own error can be told and taken off) are
//! kept in the directory and reused by a later run of the same size and samples. `noise.json`
//! holds every render and the table is printed.

use crate::{render_progressive, render_until, sheet, RenderOutput};
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
    /// `uniform`, `adaptive` (the same time) or `adaptive-rays` (as many rays as the uniform one).
    pub mode: &'static str,
    /// The round (its seed is `1 + round`; the references' are 1000 and 2000).
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

/// `scene` with `seed`, sampled adaptively (to `target`) or not.
fn with(scene: &Scene, seed: u32, adaptive: bool, target: f32) -> Scene {
    let mut scene = scene.clone();
    scene.render.seed = seed;
    scene.render.adaptive = if adaptive { ADAPTIVE_ON } else { 0 };
    scene.render.noise_threshold = if adaptive { target } else { 0.0 };
    scene
}

/// The references of `key` (seeds 1000 and 2000, `samples` each, uniform) and the seconds the
/// first took: read from `dir` when a run of before left them there, else rendered and kept.
type References = (Vec<f32>, Vec<f32>, f64);

fn references(
    dir: &Path,
    key: &str,
    scene: &Scene,
    samples: u32,
    threads: usize,
) -> Result<References, String> {
    let (w, h) = (scene.render.width, scene.render.height);
    let path = dir.join(format!("reference-{key}-{w}x{h}-{samples}.f32"));
    let n = (w * h * 3) as usize;
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() == n * 8 {
            let v: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            return Ok((v[..n].to_vec(), v[n..].to_vec(), 0.0));
        }
    }
    let one = render_progressive(&with(scene, 1000, false, 0.0), samples, threads, None);
    let two = render_progressive(&with(scene, 2000, false, 0.0), samples, threads, None);
    let (a, b) = (one.film.resolve(), two.film.resolve());
    let bytes: Vec<u8> = a.iter().chain(&b).flat_map(|v| v.to_le_bytes()).collect();
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok((a, b, one.elapsed.as_secs_f64()))
}

/// Runs the measurement: per scene the references of `reference` samples, then `rounds` rounds of a
/// uniform render of `seconds`, an adaptive one of the same time and an adaptive one of as many
/// rays (to the noise `target`, 0: none). Writes `noise.json` into `dir` and returns the table.
#[allow(clippy::too_many_arguments)]
pub fn run(
    dir: &Path,
    size: (u32, u32),
    seconds: f64,
    reference: u32,
    rounds: u32,
    threads: usize,
    target: f32,
) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut rows = Vec::new();
    let mut refs = Vec::new();
    for (key, scene) in scenes(size) {
        let (reference_image, other, took) = references(dir, key, &scene, reference, threads)?;
        // Two references of independent noise: half their relative error is each one's own.
        let own = rel_mse(&other, &reference_image) / 2.0;
        eprintln!("{key}: reference of {reference} spp ({took:.1} s), its own relMSE {own:.8}");
        refs.push((key, took, own));
        let budget = Duration::from_secs_f64(seconds);
        for round in 0..rounds {
            let seed = 1 + round;
            let mut row = |mode: &'static str, out: &RenderOutput| {
                let samples = out
                    .adaptive
                    .map_or((out.samples, out.samples), |a| (a.min, a.max));
                let r = NoiseRow {
                    scene: key,
                    mode,
                    round,
                    seconds: out.elapsed.as_secs_f64(),
                    samples,
                    rays: out.rays,
                    rel_mse: rel_mse(&out.film.resolve(), &reference_image),
                };
                eprintln!(
                    "{key} {mode} round {round}: {:.2} s, {}..{} spp, {} rays, relMSE {:.8}",
                    r.seconds, samples.0, samples.1, r.rays, r.rel_mse
                );
                rows.push(r);
            };
            let uniform = render_progressive(
                &with(&scene, seed, false, 0.0),
                1 << 24,
                threads,
                Some(budget),
            );
            row("uniform", &uniform);
            let timed = render_progressive(
                &with(&scene, seed, true, target),
                1 << 24,
                threads,
                Some(budget),
            );
            row("adaptive", &timed);
            let rays = uniform.rays;
            let spent = |r: u64, _: Duration| r >= rays;
            let even = render_until(&with(&scene, seed, true, target), 1 << 24, threads, &spent);
            row("adaptive-rays", &even);
        }
    }
    let table = table(&rows, &refs);
    let mut json = String::from("{\n");
    let _ = writeln!(
        json,
        "  \"size\": [{}, {}],\n  \"seconds\": {seconds},\n  \"referenceSamples\": {reference},\n  \"rounds\": {rounds},\n  \"threads\": {threads},\n  \"noiseTarget\": {target},",
        size.0, size.1
    );
    json.push_str("  \"references\": [");
    for (i, (key, s, own)) in refs.iter().enumerate() {
        let _ = write!(
            json,
            "{}{{\"scene\": \"{key}\", \"seconds\": {s:.3}, \"ownRelMse\": {own:.10}}}",
            if i > 0 { ", " } else { "" }
        );
    }
    json.push_str("],\n  \"renders\": [\n");
    for (i, r) in rows.iter().enumerate() {
        let _ = writeln!(
            json,
            "    {{\"scene\": \"{}\", \"mode\": \"{}\", \"round\": {}, \"seconds\": {:.3}, \"samples\": [{}, {}], \"rays\": {}, \"relMse\": {:.10}}}{}",
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
    let path = dir.join("noise.json");
    std::fs::write(&path, json).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(table)
}

/// Per scene and mode the mean relative error, the same with the reference's own error taken off,
/// and that time-scaled (`relMSE × t / t̄` with the uniform renders' mean time `t̄`, since the error
/// of a progressive render falls as 1/t); and the ratios adaptive / uniform.
pub fn table(rows: &[NoiseRow], refs: &[(&str, f64, f64)]) -> String {
    let mut out = String::from(
        "scene         mode           seconds  samples           relMSE   -ref noise  at uniform t\n",
    );
    for &(key, _, own) in refs {
        let of = |mode: &str| -> Vec<&NoiseRow> {
            rows.iter()
                .filter(|r| r.scene == key && r.mode == mode)
                .collect()
        };
        let mean = |v: &[&NoiseRow], f: &dyn Fn(&NoiseRow) -> f64| {
            v.iter().map(|r| f(r)).sum::<f64>() / v.len().max(1) as f64
        };
        let t = mean(&of("uniform"), &|r| r.seconds);
        let mut line = |mode: &str| -> (f64, f64, f64) {
            let v = of(mode);
            let e = mean(&v, &|r| r.rel_mse);
            let corrected = e - own;
            let scaled = mean(&v, &|r| (r.rel_mse - own) * r.seconds / t);
            let (lo, hi) = (
                v.iter().map(|r| r.samples.0).min().unwrap_or(0),
                v.iter().map(|r| r.samples.1).max().unwrap_or(0),
            );
            let _ = writeln!(
                out,
                "{key:<13} {mode:<14} {:>7.2}  {lo:>5}-{hi:<6} {e:>12.8} {corrected:>12.8} {scaled:>12.8}",
                mean(&v, &|r| r.seconds)
            );
            (e, corrected, scaled)
        };
        let (ue, uc, us) = line("uniform");
        let (ae, ac, ascaled) = line("adaptive");
        let (re, rc, _) = line("adaptive-rays");
        let _ = writeln!(
            out,
            "{key:<13} ratio, same time               {:>12.3} {:>12.3} {:>12.3}",
            ae / ue,
            ac / uc,
            ascaled / us
        );
        let _ = writeln!(
            out,
            "{key:<13} ratio, same rays               {:>12.3} {:>12.3}",
            re / ue,
            rc / uc
        );
    }
    out
}

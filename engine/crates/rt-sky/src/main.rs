//! `rt-sky`: the offline sky tools (see the crate documentation).

#![allow(clippy::needless_range_loop)]

use rt_sky::atmosphere::Atmosphere;
use rt_sky::dataset::{self, Grid, Sky, RECIPE};
use rt_sky::fit::{fit_knot, slice_errors, AUREOLE_DEG};
use rt_sky::model::{Table, View, ALBEDOS, CHANNELS, TURBIDITIES};
use rt_sky::simulate::{parallel_map, sky, sun_direction, view_direction, GREY_ALBEDO};
use rt_sky::spectrum::{bands_to_rgb, cmf_weights, BANDS};
use rt_sky::table::{rust_source, ts_source, Flat};
use std::fmt::Write as _;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

const USAGE: &str = "\
rt-sky: Repackshot's own daylight sky, offline (phase E5c)

USAGE:
    rt-sky table [--threads N] [--cache FILE]
        Simulates the skies of the recipe (or reads them from the cache), fits the table and
        writes engine/crates/rt-core/src/sky_table.rs, src/core/sky-table.ts and
        engine/crates/rt-sky/table.json (the fit's errors).
    rt-sky validate [--threads N] [--paths N] [--cache FILE]
        Simulates low-noise skies between the table's knots and compares the committed table
        with them, with the CIE standard clear skies and with the classic sky; writes
        engine/crates/rt-sky/validation.json.
    rt-sky fisheye <dir> [--size N] [--paths N] [--threads N] [--model] [--seed N]
        Fisheye images (raw little-endian f32 RGB and index.json) of the simulator, or of the
        committed table with --model, at four Sun elevations, clear and hazy.
    rt-sky fixture
        Writes tests/fixtures/sky-physical.json: the engine's physical sky at sampled pixels of
        six skies, which the preview's port is checked against.
    rt-sky diag [--paths N] [--threads N]
        Zenith chromaticity with and without ozone, and the almucantar against the CIE skies.
    rt-sky report | noise | fit-knot <turbidity> <albedo 0|1> <channel 0..2> [--cache FILE]
        From the cached simulation: the committed table's error per knot and channel; the
        simulation noise (some skies again with another seed); one knot's fit, stage by stage.
";

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn write_f32(path: &Path, data: &[f32]) -> std::io::Result<()> {
    let mut f = std::fs::File::create(path)?;
    let bytes: Vec<u8> = data.iter().flat_map(|v| v.to_le_bytes()).collect();
    f.write_all(&bytes)
}

fn luminance(c: [f64; 3]) -> f64 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/// The committed table.
fn committed() -> Table {
    Flat {
        coefficients: rt_core::sky_table::COEFFICIENTS.to_vec(),
        radiance: rt_core::sky_table::RADIANCE.to_vec(),
    }
    .table()
}

/// The skies of `configs` from `cache` when it holds them for `key`, else simulated (and cached).
fn skies(
    configs: &[(f64, f64)],
    grid: &Grid,
    paths: usize,
    threads: usize,
    cache: &Path,
    label: &str,
) -> Vec<Sky> {
    let key = format!(
        "v1 {label} seed {:#x} paths {paths} grid {} configs {configs:?}",
        RECIPE.seed,
        grid.len()
    );
    if let Some(s) = dataset::load(cache, &key) {
        eprintln!("{label}: {} skies from {}", s.len(), cache.display());
        return s;
    }
    let start = Instant::now();
    eprintln!(
        "{label}: simulating {} skies x {} directions x {paths} paths on {threads} threads",
        configs.len(),
        grid.len()
    );
    let s = dataset::simulate(configs, grid, paths, RECIPE.seed, threads, label);
    eprintln!(
        "{label}: simulated in {:.0} s",
        start.elapsed().as_secs_f64()
    );
    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = dataset::save(cache, &key, &s) {
        eprintln!("cache not written: {e}");
    }
    s
}

fn default_cache(name: &str) -> PathBuf {
    crate_dir().join("../../target/rt-sky").join(name)
}

fn table(threads: usize, cache: Option<PathBuf>) -> Result<(), String> {
    let grid = Grid::fit();
    let configs = dataset::fit_configs(&RECIPE);
    let cache = cache.unwrap_or_else(|| default_cache("fit.bin"));
    let data = skies(&configs, &grid, RECIPE.paths, threads, &cache, "fit");
    let start = Instant::now();
    let knots = parallel_map(TURBIDITIES * ALBEDOS * CHANNELS, threads, |i| {
        let (t, a, c) = (
            i / (ALBEDOS * CHANNELS),
            (i / CHANNELS) % ALBEDOS,
            i % CHANNELS,
        );
        fit_knot(&dataset::slices(&data, &grid, t, a, c))
    });
    eprintln!("fit: 60 knots in {:.0} s", start.elapsed().as_secs_f64());
    let table = Table { knots };
    let flat = Flat::new(&table);
    // The errors of the table as the engine has it (f32 values).
    let used = flat.table();
    let mut json = String::new();
    let _ = writeln!(json, "{{");
    let _ = writeln!(
        json,
        "  \"recipe\": \"{}\",",
        rt_sky::table::recipe_text(&RECIPE).replace('`', "")
    );
    let _ = writeln!(json, "  \"sha256\": \"{}\",", flat.sha256());
    let _ = writeln!(json, "  \"aureole_deg\": {AUREOLE_DEG},");
    let _ = writeln!(json, "  \"note\": \"per turbidity, albedo and elevation: solid-angle weighted RMS of the relative error of the luminance outside the aureole, inside it, and the largest per-channel RMS outside it, against the (noisy) simulated skies the table was fitted to\",");
    let _ = writeln!(json, "  \"errors\": [");
    let mut worst = 0.0f64;
    let mut sum = (0.0, 0usize);
    let mut rows = Vec::new();
    for t in 0..TURBIDITIES {
        for a in 0..ALBEDOS {
            let per_channel: Vec<Vec<rt_sky::fit::Slice>> = (0..CHANNELS)
                .map(|c| dataset::slices(&data, &grid, t, a, c))
                .collect();
            for e in 0..RECIPE.elevations {
                let mut channel_rms = 0.0f64;
                for c in 0..CHANNELS {
                    let knot = &used.knots[Table::index(t, a, c)];
                    let (out, _, _) = slice_errors(knot, &per_channel[c][e]);
                    channel_rms = channel_rms.max(out);
                }
                let el = per_channel[0][e].elevation_deg;
                let (out, inn) =
                    luminance_errors(&used, &data, &grid, (t + 1) as f64, a as f64, el, a);
                worst = worst.max(out);
                sum.0 += out;
                sum.1 += 1;
                rows.push(format!(
                    "    {{ \"turbidity\": {}, \"albedo\": {a}, \"elevation\": {:.4}, \"rms_outside\": {:.5}, \"rms_inside\": {:.5}, \"channel_rms_outside\": {:.5} }}",
                    t + 1, el, out, inn, channel_rms
                ));
            }
        }
    }
    json.push_str(&rows.join(",\n"));
    let _ = writeln!(json, "\n  ],");
    let _ = writeln!(json, "  \"mean_rms_outside\": {:.5},", sum.0 / sum.1 as f64);
    let _ = writeln!(json, "  \"worst_rms_outside\": {worst:.5}");
    let _ = writeln!(json, "}}");
    eprintln!(
        "fit errors (luminance, outside the aureole, vs the fitted data): mean {:.2} %, worst {:.2} %",
        100.0 * sum.0 / sum.1 as f64,
        100.0 * worst
    );
    let rust = crate_dir().join("../rt-core/src/sky_table.rs");
    let ts = crate_dir().join("../../../src/core/sky-table.ts");
    std::fs::write(&rust, rust_source(&flat, &RECIPE)).map_err(|e| e.to_string())?;
    std::fs::write(&ts, ts_source(&flat)).map_err(|e| e.to_string())?;
    std::fs::write(crate_dir().join("table.json"), json).map_err(|e| e.to_string())?;
    eprintln!(
        "wrote {} and {} (sha256 {})",
        rust.display(),
        ts.display(),
        flat.sha256()
    );
    Ok(())
}

/// Luminance errors of `table` (turbidity and albedo interpolated as the engine does) against a
/// simulated sky: RMS relative error outside the aureole and inside it. `which` picks the
/// simulated ground: 0 black, 1 white, 2 grey.
fn luminance_errors(
    table: &Table,
    data: &[Sky],
    grid: &Grid,
    turbidity: f64,
    albedo: f64,
    elevation: f64,
    which: usize,
) -> (f64, f64) {
    let Some(sky) = data
        .iter()
        .find(|s| s.turbidity == turbidity && s.elevation_deg == elevation)
    else {
        return (f64::NAN, f64::NAN);
    };
    let sun = sun_direction(elevation);
    let (mut o, mut wo, mut i, mut wi) = (0.0, 0.0, 0.0, 0.0);
    for ((v, w), rgb) in grid.views.iter().zip(&grid.weights).zip(&sky.rgb) {
        let m = luminance(table.rgb(turbidity, albedo, elevation, *v, sun));
        let d = luminance(rgb[which]);
        let e = (m - d) / d;
        if View::new(*v, sun).gamma < AUREOLE_DEG.to_radians() {
            i += w * e * e;
            wi += w;
        } else {
            o += w * e * e;
            wo += w;
        }
    }
    (
        (o / wo).sqrt(),
        if wi > 0.0 { (i / wi).sqrt() } else { 0.0 },
    )
}

/// CIE general sky relative luminance `L / L_zenith` (CIE S 011/E:2003, ISO 15469:2004) for the
/// parameters `(a, b, c, d, e)`; angles in radians.
fn cie(p: [f64; 5], zenith_angle: f64, gamma: f64, sun_zenith: f64) -> f64 {
    let [a, b, c, d, e] = p;
    let phi = |z: f64| {
        if z >= std::f64::consts::FRAC_PI_2 {
            1.0
        } else {
            1.0 + a * rt_sky::dmath::exp(b / rt_sky::dmath::cos(z))
        }
    };
    let f = |x: f64| {
        1.0 + c * (rt_sky::dmath::exp(d * x) - rt_sky::dmath::exp(d * std::f64::consts::FRAC_PI_2))
            + e * rt_sky::dmath::cos(x) * rt_sky::dmath::cos(x)
    };
    f(gamma) * phi(zenith_angle) / (f(sun_zenith) * phi(0.0))
}

/// CIE type 12 (clear, low turbidity) and 13 (clear, polluted).
const CIE_12: [f64; 5] = [-1.0, -0.32, 10.0, -3.0, 0.45];
const CIE_13: [f64; 5] = [-1.0, -0.32, 16.0, -3.0, 0.30];

fn validate(threads: usize, paths: usize, cache: Option<PathBuf>) -> Result<(), String> {
    let grid = Grid::validation();
    let turbidities = [2.0, 2.5, 4.0, 6.5, 9.0];
    let elevations = [0.5, 3.0, 10.0, 20.0, 35.0, 50.0, 70.0, 85.0];
    let configs: Vec<(f64, f64)> = turbidities
        .iter()
        .flat_map(|&t| elevations.iter().map(move |&e| (t, e)))
        .collect();
    let cache = cache.unwrap_or_else(|| default_cache("validation.bin"));
    let data = skies(&configs, &grid, paths, threads, &cache, "validation");
    let table = committed();
    let mut json = String::from("{\n");
    let _ = writeln!(
        json,
        "  \"table_sha256\": \"{}\",",
        rt_core::sky_table::SHA256
    );
    let _ = writeln!(json, "  \"paths\": {paths},");
    let _ = writeln!(json, "  \"directions\": {},", grid.len());
    let _ = writeln!(json, "  \"aureole_deg\": {AUREOLE_DEG},");
    let _ = writeln!(json, "  \"note\": \"luminance RMS relative error of the table (turbidity and albedo interpolated as the engine does) against low-noise simulated skies off the fitted elevations; black, white and grey (albedo {GREY_ALBEDO}) grounds; cie: RMS of the relative difference of L/L_zenith from the CIE standard clear skies 12 and 13 outside the aureole (shape only, the sky luminance distribution of ISO 15469); classic: the same for the Preetham sky\",");
    let _ = writeln!(json, "  \"skies\": [");
    let mut rows = Vec::new();
    eprintln!("turbidity elevation | table vs simulation outside the aureole: black white grey (inside, black) | shape vs CIE 12, CIE 13 | classic vs CIE 12, 13");
    let mut worst = 0.0f64;
    for s in &data {
        let (t, el) = (s.turbidity, s.elevation_deg);
        let (b_out, b_in) = luminance_errors(&table, &data, &grid, t, 0.0, el, 0);
        let (w_out, _) = luminance_errors(&table, &data, &grid, t, 1.0, el, 1);
        let (g_out, _) = luminance_errors(&table, &data, &grid, t, GREY_ALBEDO, el, 2);
        worst = worst.max(b_out).max(w_out);
        // Shape against the CIE skies: L / L_zenith outside the aureole, black ground.
        let sun = sun_direction(el);
        let zen = rt_sky::simulate::sky_view(
            &Atmosphere::new(t),
            el,
            [0.0, 0.0, 1.0],
            paths,
            &[RECIPE.seed, 7, t.to_bits(), el.to_bits()],
        );
        let lz = luminance(bands_to_rgb(&zen.black, &cmf_weights()));
        let preetham = rt_core::sky::Preetham::new(0.0, el as f32, t as f32);
        let pz = preetham
            .radiance(rt_core::math::Vec3::new(0.0, 0.0, 1.0))
            .luminance() as f64;
        let mut acc = [(0.0, 0.0); 4];
        for ((v, w), rgb) in grid.views.iter().zip(&grid.weights).zip(&s.rgb) {
            let view = View::new(*v, sun);
            if view.gamma < AUREOLE_DEG.to_radians() {
                continue;
            }
            let ours = luminance(rgb[0]) / lz;
            let classic = preetham
                .radiance(rt_core::math::Vec3::new(
                    v[0] as f32,
                    v[1] as f32,
                    v[2] as f32,
                ))
                .luminance() as f64
                / pz;
            let zenith_angle = rt_sky::dmath::acos(v[2]);
            let sun_zenith = (90.0 - el) * rt_sky::dmath::DEG;
            for (k, (model, p)) in [
                (ours, CIE_12),
                (ours, CIE_13),
                (classic, CIE_12),
                (classic, CIE_13),
            ]
            .into_iter()
            .enumerate()
            {
                let c = cie(p, zenith_angle, view.gamma, sun_zenith);
                let e = (model - c) / c;
                acc[k].0 += w * e * e;
                acc[k].1 += w;
            }
        }
        let r: Vec<f64> = acc.iter().map(|(s, w)| (s / w).sqrt()).collect();
        eprintln!(
            "  T {t:>4} sun {el:>5} | {:>5.2} {:>5.2} {:>5.2} % ({:>5.2} %) | {:>5.1} {:>5.1} % | {:>5.1} {:>5.1} %",
            100.0 * b_out, 100.0 * w_out, 100.0 * g_out, 100.0 * b_in, 100.0 * r[0], 100.0 * r[1], 100.0 * r[2], 100.0 * r[3]
        );
        rows.push(format!(
            "    {{ \"turbidity\": {t}, \"elevation\": {el}, \"rms_black\": {b_out:.5}, \"rms_white\": {w_out:.5}, \"rms_grey\": {g_out:.5}, \"rms_black_aureole\": {b_in:.5}, \"cie12\": {:.4}, \"cie13\": {:.4}, \"classic_cie12\": {:.4}, \"classic_cie13\": {:.4} }}",
            r[0], r[1], r[2], r[3]
        ));
    }
    json.push_str(&rows.join(",\n"));
    let _ = writeln!(json, "\n  ],");
    let _ = writeln!(json, "  \"worst_rms\": {worst:.5}");
    json.push_str("}\n");
    eprintln!(
        "worst RMS outside the aureole (black and white grounds): {:.2} %",
        100.0 * worst
    );
    std::fs::write(crate_dir().join("validation.json"), json).map_err(|e| e.to_string())
}

fn fisheye(
    dir: PathBuf,
    size: usize,
    paths: usize,
    threads: usize,
    seed: u64,
    model: bool,
) -> Result<(), String> {
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let w = cmf_weights();
    let table = committed();
    let mut entries = Vec::new();
    for (turbidity, haze) in [(2.5, "clear"), (7.0, "hazy")] {
        let atm = Atmosphere::new(turbidity);
        for (name, elevation) in [
            ("sunrise", 1.0),
            ("golden-hour", 8.0),
            ("mid-morning", 30.0),
            ("noon", 65.0),
        ] {
            // Equidistant fisheye, the Sun towards +x (right); only the upper half is computed
            // (the sky is symmetric about the Sun's vertical plane).
            let half = size.div_ceil(2);
            let mut views = Vec::new();
            let mut pixels = Vec::new();
            for j in 0..half {
                for i in 0..size {
                    let x = (i as f64 + 0.5) / size as f64 * 2.0 - 1.0;
                    let y = (j as f64 + 0.5) / size as f64 * 2.0 - 1.0;
                    let r = (x * x + y * y).sqrt();
                    if r < 1.0 {
                        views.push(view_direction(
                            r * rt_sky::dmath::FRAC_PI_2,
                            rt_sky::dmath::atan2(-y, x),
                        ));
                        pixels.push((i, j));
                    }
                }
            }
            let start = Instant::now();
            let rgb: Vec<[f64; 3]> = if model {
                let sun = sun_direction(elevation);
                views
                    .iter()
                    .map(|v| table.rgb(turbidity, 0.0, elevation, *v, sun))
                    .collect()
            } else {
                let keys = [seed, turbidity.to_bits(), elevation.to_bits()];
                sky(&atm, elevation, &views, paths, &keys, threads)
                    .iter()
                    .map(|r| bands_to_rgb(&r.black, &w))
                    .collect()
            };
            let secs = start.elapsed().as_secs_f64();
            let mut img = vec![0.0f32; 3 * size * size];
            for (c3, &(i, j)) in rgb.iter().zip(&pixels) {
                for jj in [j, size - 1 - j] {
                    for c in 0..3 {
                        img[3 * (jj * size + i) + c] = c3[c] as f32;
                    }
                }
            }
            let file = format!("{name}-{haze}.f32");
            write_f32(&dir.join(&file), &img).map_err(|e| e.to_string())?;
            eprintln!("{file}: {} directions in {secs:.1} s", views.len());
            entries.push(format!(
                "  {{\"file\": \"{file}\", \"size\": {size}, \"elevation\": {elevation}, \"turbidity\": {turbidity}, \"seconds\": {secs:.2}, \"paths\": {}}}",
                if model { 0 } else { paths }
            ));
        }
    }
    std::fs::write(
        dir.join("index.json"),
        format!("[\n{}\n]\n", entries.join(",\n")),
    )
    .map_err(|e| e.to_string())
}

fn xy(rgb: [f64; 3]) -> (f64, f64) {
    let [r, g, b] = rgb;
    let x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
    (x / (x + y + z), y / (x + y + z))
}

fn diag(paths: usize, threads: usize) {
    let w = cmf_weights();
    eprintln!("zenith chromaticity xy, turbidity 2.5: with ozone | without | classic sky");
    for el in [1.0, 4.0, 8.0, 30.0, 65.0] {
        let mut line = format!("  sun {el:>4}:");
        for du in [300.0, 0.0] {
            let atm = Atmosphere::with_ozone(2.5, du);
            let r = sky(&atm, el, &[[0.0, 0.0, 1.0]], paths, &[1], threads);
            let (x, y) = xy(bands_to_rgb(&r[0].black, &w));
            line += &format!("  ({x:.4}, {y:.4})");
        }
        let c = rt_core::sky::Preetham::new(0.0, el as f32, 2.5)
            .radiance(rt_core::math::Vec3::new(0.0, 0.0, 1.0));
        let (x, y) = xy([c.r as f64, c.g as f64, c.b as f64]);
        eprintln!("{line}  ({x:.4}, {y:.4})");
    }
    let deg = rt_sky::dmath::DEG;
    for (t, el, p, name) in [
        (2.0, 30.0, CIE_12, "CIE 12"),
        (2.5, 30.0, CIE_12, "CIE 12"),
        (2.5, 65.0, CIE_12, "CIE 12"),
        (4.0, 30.0, CIE_13, "CIE 13"),
        (4.0, 65.0, CIE_13, "CIE 13"),
    ] {
        let atm = Atmosphere::new(t);
        let zen = (90.0 - el) * deg;
        let mut views = vec![[0.0, 0.0, 1.0]];
        let mut gammas = Vec::new();
        for g in [3.0, 5.0, 10.0, 20.0, 30.0, 45.0, 60.0, 90.0] {
            // The azimuth at angular distance g from the Sun on its almucantar.
            let (sz, cz) = rt_sky::dmath::sin_cos(zen);
            let cphi = (rt_sky::dmath::cos(g * deg) - cz * cz) / (sz * sz);
            if cphi.abs() <= 1.0 {
                views.push(view_direction(zen, rt_sky::dmath::acos(cphi)));
                gammas.push(g);
            }
        }
        let r = sky(&atm, el, &views, paths, &[2], threads);
        let lum: Vec<f64> = r
            .iter()
            .map(|x| luminance(bands_to_rgb(&x.black, &w)))
            .collect();
        let pre = rt_core::sky::Preetham::new(0.0, el as f32, t as f32);
        let pz = pre
            .radiance(rt_core::math::Vec3::new(0.0, 0.0, 1.0))
            .luminance() as f64;
        eprintln!("T {t}, sun {el}: almucantar L/L_zenith  ours | {name} | classic");
        for (i, g) in gammas.iter().enumerate() {
            let v = views[i + 1];
            let c = pre.radiance(rt_core::math::Vec3::new(
                v[0] as f32,
                v[1] as f32,
                v[2] as f32,
            ));
            eprintln!(
                "    gamma {g:>4}: {:>7.3} | {:>7.3} | {:>7.3}",
                lum[i + 1] / lum[0],
                cie(p, zen, g * deg, zen),
                c.luminance() as f64 / pz
            );
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    let mut paths = None;
    let mut size = 96usize;
    let mut seed = 0xf15e_7e5eu64;
    let mut model = false;
    let mut cache = None;
    let mut positional = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut value = |name: &str| -> String {
            it.next().cloned().unwrap_or_else(|| {
                eprintln!("{name} needs a value\n{USAGE}");
                std::process::exit(2)
            })
        };
        let number = |name: &str, v: String| -> usize {
            v.parse().unwrap_or_else(|_| {
                eprintln!("{name} needs a number\n{USAGE}");
                std::process::exit(2)
            })
        };
        match a.as_str() {
            "--threads" => threads = number("--threads", value("--threads")).max(1),
            "--paths" => paths = Some(number("--paths", value("--paths")).max(1)),
            "--size" => size = number("--size", value("--size")).max(8),
            "--seed" => seed = number("--seed", value("--seed")) as u64,
            "--cache" => cache = Some(PathBuf::from(value("--cache"))),
            "--model" => model = true,
            "-h" | "--help" => {
                print!("{USAGE}");
                return;
            }
            _ => positional.push(a.clone()),
        }
    }
    let result = match positional.first().map(String::as_str) {
        Some("table") => table(threads, cache),
        Some("validate") => validate(threads, paths.unwrap_or(128 * BANDS), cache),
        Some("fisheye") if positional.len() == 2 => fisheye(
            PathBuf::from(&positional[1]),
            size,
            paths.unwrap_or(16 * BANDS),
            threads,
            seed,
            model,
        ),
        Some("fixture") => {
            let path = crate_dir().join("../../../tests/fixtures/sky-physical.json");
            std::fs::write(&path, rt_sky::fixture::json())
                .map_err(|e| e.to_string())
                .map(|()| eprintln!("wrote {}", path.display()))
        }
        Some("fit-knot") if positional.len() == 4 => {
            let n = |i: usize| positional[i].parse::<usize>().unwrap_or(0);
            let grid = Grid::fit();
            let configs = dataset::fit_configs(&RECIPE);
            let cache = cache.clone().unwrap_or_else(|| default_cache("fit.bin"));
            let data = skies(&configs, &grid, RECIPE.paths, threads, &cache, "fit");
            let sl = dataset::slices(&data, &grid, n(1) - 1, n(2), n(3));
            let start = Instant::now();
            let knot = rt_sky::fit::fit_knot_traced(&sl, &mut |m| eprintln!("  {m}"));
            for s in &sl {
                let (o, i, m) = slice_errors(&knot, s);
                eprintln!(
                    "  final {:7.3}: rms {:5.2} % inside {:5.2} % max {:5.1} %",
                    s.elevation_deg,
                    100.0 * o,
                    100.0 * i,
                    100.0 * m
                );
            }
            eprintln!("  {:.1} s", start.elapsed().as_secs_f64());
            Ok(())
        }
        Some("noise") => {
            // The simulation noise of the fitted skies: some of them again with another seed.
            let grid = Grid::fit();
            let configs = dataset::fit_configs(&RECIPE);
            let cache = cache.clone().unwrap_or_else(|| default_cache("fit.bin"));
            let data = skies(&configs, &grid, RECIPE.paths, threads, &cache, "fit");
            let e = dataset::fit_elevations(RECIPE.elevations);
            let picks: Vec<(f64, f64)> = vec![
                (1.0, e[1]),
                (2.0, e[1]),
                (2.0, e[4]),
                (2.0, e[9]),
                (2.0, e[14]),
                (6.0, e[5]),
                (9.0, e[6]),
                (9.0, e[12]),
            ];
            let again = dataset::simulate(
                &picks,
                &grid,
                RECIPE.paths,
                RECIPE.seed + 1,
                threads,
                "noise",
            );
            for s in &again {
                let a = data
                    .iter()
                    .find(|d| d.turbidity == s.turbidity && d.elevation_deg == s.elevation_deg)
                    .unwrap();
                let sun = sun_direction(s.elevation_deg);
                for g in 0..2 {
                    let (mut o, mut w) = (0.0, 0.0);
                    for ((v, wt), (x, y)) in grid
                        .views
                        .iter()
                        .zip(&grid.weights)
                        .zip(a.rgb.iter().zip(&s.rgb))
                    {
                        if View::new(*v, sun).gamma < AUREOLE_DEG.to_radians() {
                            continue;
                        }
                        let (lx, ly) = (luminance(x[g]), luminance(y[g]));
                        let e = (lx - ly) / (0.5 * (lx + ly));
                        o += wt * e * e;
                        w += wt;
                    }
                    eprintln!(
                        "  T {} sun {:7.3} ground {g}: noise per sky {:5.2} %",
                        s.turbidity,
                        s.elevation_deg,
                        100.0 * (o / w / 2.0).sqrt()
                    );
                }
            }
            Ok(())
        }
        Some("report") => {
            let grid = Grid::fit();
            let configs = dataset::fit_configs(&RECIPE);
            let cache = cache.clone().unwrap_or_else(|| default_cache("fit.bin"));
            let data = skies(&configs, &grid, RECIPE.paths, threads, &cache, "fit");
            let table = committed();
            for t in 0..TURBIDITIES {
                for a in 0..ALBEDOS {
                    let mut line = format!("T {:>2} a {a}:", t + 1);
                    for c in 0..CHANNELS {
                        let sl = dataset::slices(&data, &grid, t, a, c);
                        let knot = &table.knots[Table::index(t, a, c)];
                        let errs: Vec<f64> = sl.iter().map(|s| slice_errors(knot, s).0).collect();
                        let worst = errs.iter().cloned().fold(0.0, f64::max);
                        line += &format!(
                            "  c{c} mean {:5.1} % worst {:5.1} %",
                            100.0 * errs.iter().sum::<f64>() / errs.len() as f64,
                            100.0 * worst
                        );
                    }
                    eprintln!("{line}");
                }
            }
            Ok(())
        }
        Some("diag") => {
            diag(paths.unwrap_or(64 * BANDS), threads);
            Ok(())
        }
        _ => Err(USAGE.to_string()),
    };
    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cie_formula_has_its_landmarks() {
        // L / L_zenith is 1 at the zenith; brighter towards the Sun than away from it; type 13
        // (polluted) has the stronger circumsolar indicatrix; at the Sun's zenith angle on its
        // almucantar, 90 degrees away, the indicatrix is 1 + e cos² 90° = 1 over f(Z_s).
        let z = 0.5;
        assert!((cie(CIE_12, 0.0, z, z) - 1.0).abs() < 1.0e-12);
        assert!(cie(CIE_12, z, 0.05, z) > cie(CIE_12, z, 1.5, z));
        assert!(cie(CIE_13, z, 0.05, z) > cie(CIE_12, z, 0.05, z));
        let f = |x: f64| {
            1.0 + 10.0 * ((-3.0 * x).exp() - (-3.0 * std::f64::consts::FRAC_PI_2).exp())
                + 0.45 * x.cos() * x.cos()
        };
        let right = std::f64::consts::FRAC_PI_2;
        assert!((cie(CIE_12, 0.0, right - z, z) - f(right - z) / f(z)).abs() < 1.0e-12);
    }
}

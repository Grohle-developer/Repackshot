//! The sheet of the effect filters (O3a, `rt --filter-sheet <dir>`; `tools/lens-filters-sheet.mjs`
//! writes its page): the perfume bottle with a small spot behind it in the frame and another one
//! outside it, through every filter at the grades 1/4, 1 and 2, two stacks, no filter, and three
//! filters without their connections to the lights (the scattering alone), for comparison. And
//! the measurement of the noise the filters add, with and without those connections
//! (`rt --filter-noise <dir>`, `noise.json` next to the sheet).

use crate::render_progressive;
use crate::scenes::glass_bottle;
use rt_core::color::Rgb;
use rt_core::math::Vec3;
use rt_core::optics::filters::*;
use rt_core::scene::{
    Lens, LensParams, Light, LightKind, Scene, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY,
};
use std::path::Path;

/// Size and samples of the sheet (the brief: 512 px wide, 128 spp).
pub const FILTER_SHEET_SIZE: (u32, u32) = (512, 384);
/// See [`FILTER_SHEET_SIZE`].
pub const FILTER_SHEET_SAMPLES: u32 = 128;

/// The kinds of the sheet, in the order of `src/data/lens-filters.ts`, with their file names.
pub const KINDS: [(u32, &str); 8] = [
    (FILTER_DIFFUSION_WHITE, "diffusion-white"),
    (FILTER_DIFFUSION_BLACK, "diffusion-black"),
    (FILTER_DIFFUSION_GOLD, "diffusion-gold"),
    (FILTER_GLIMMER, "glimmer"),
    (FILTER_SOFT, "soft"),
    (FILTER_NET, "net"),
    (FILTER_STAR, "star"),
    (FILTER_STREAK, "streak"),
];

/// The grades of the sheet.
pub const SHEET_GRADES: [(f32, &str); 3] = [(0.25, "1-4"), (1.0, "1"), (2.0, "2")];

/// One image of the sheet.
pub struct FilterCell {
    /// File name without the extension.
    pub key: String,
    /// The filters, as `kind:grade` (empty: none).
    pub stack: Vec<(u32, f32)>,
    /// The scene.
    pub scene: Scene,
    /// Whether the filters connect to the lights (the comparison cells render the scattering
    /// alone).
    pub connect: bool,
}

/// The bottle of the sheet: [`glass_bottle`] without its backlit panel, on a darker dome, with a
/// small bright spot behind the bottle in the frame (backlight) and another one above the frame,
/// both seen by the camera, through `filters`.
pub fn filter_bottle(size: (u32, u32), filters: [FilterParams; 3]) -> Scene {
    let mut scene = glass_bottle(size);
    scene.lights.truncate(2);
    scene.environment.strength = 0.25;
    let disk = |position: Vec3, diameter: f32, power: f32| Light {
        kind: LightKind::Disk,
        position,
        direction: (scene.camera.position - position).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: diameter,
        size_y: diameter,
        color: Rgb::new(1.0, 0.96, 0.9),
        power,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_CAMERA | LIGHT_FLAG_GLOSSY,
    };
    // In the frame, behind the bottle and to its right (about 4° right and 2° up); just above the
    // frame (13° up, the frame reaching 9°), out of it.
    let (forward, right, up) = scene.camera.basis();
    let at = |f: f32, r: f32, u: f32| scene.camera.position + forward * f + right * r + up * u;
    let inside = disk(at(940.0, 70.0, 40.0), 12.0, 0.6);
    let outside = disk(at(700.0, -90.0, 161.0), 20.0, 1.5);
    scene.lights.push(inside);
    scene.lights.push(outside);
    scene.camera.lens = Some(
        Lens::new(LensParams {
            filters,
            ..LensParams::default()
        })
        .unwrap_or_else(|e| panic!("the sheet's filters are valid: {e}")),
    );
    scene
}

fn one(kind: u32, grade: f32) -> FilterParams {
    FilterParams {
        kind,
        grade,
        points: if kind == FILTER_STAR { 6 } else { 0 },
        ..FilterParams::default()
    }
}

/// Every image of the sheet.
pub fn cells(size: (u32, u32)) -> Vec<FilterCell> {
    let none = FilterParams::default();
    let mut out = vec![FilterCell {
        key: "none".into(),
        stack: Vec::new(),
        scene: filter_bottle(size, [none; 3]),
        connect: true,
    }];
    for (kind, name) in KINDS {
        for (grade, g) in SHEET_GRADES {
            out.push(FilterCell {
                key: format!("{name}--{g}"),
                stack: vec![(kind, grade)],
                scene: filter_bottle(size, [one(kind, grade), none, none]),
                connect: true,
            });
        }
    }
    let stacks = [
        (
            "stack--black-1-2--star-6",
            [
                one(FILTER_DIFFUSION_BLACK, 0.5),
                one(FILTER_STAR, 1.0),
                none,
            ],
        ),
        (
            "stack--gold-1--streak",
            [
                one(FILTER_DIFFUSION_GOLD, 1.0),
                one(FILTER_STREAK, 1.0),
                none,
            ],
        ),
    ];
    for (key, filters) in stacks {
        out.push(FilterCell {
            key: key.into(),
            stack: filters
                .iter()
                .filter(|f| f.kind != FILTER_NONE)
                .map(|f| (f.kind, f.grade))
                .collect(),
            scene: filter_bottle(size, filters),
            connect: true,
        });
    }
    // The comparison: the scattering alone, without the connections to the lights.
    for (kind, grade, key) in [
        (FILTER_STAR, 1.0, "star--1--alone"),
        (FILTER_DIFFUSION_BLACK, 2.0, "diffusion-black--2--alone"),
        (FILTER_GLIMMER, 1.0, "glimmer--1--alone"),
    ] {
        out.push(FilterCell {
            key: key.into(),
            stack: vec![(kind, grade)],
            scene: filter_bottle(size, [one(kind, grade), none, none]),
            connect: false,
        });
    }
    out
}

/// Renders the sheet into `dir`: one PNG per cell and `index.json` (key, stack, samples, rays,
/// seconds). With `only`, just those cells; the other lines of an existing `index.json` stay.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    threads: usize,
    only: &[String],
) -> Result<usize, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("index.json");
    // The cells of an earlier index, one per line, by key.
    let earlier = std::fs::read_to_string(&path).unwrap_or_default();
    let line_of = |key: &str| {
        earlier
            .lines()
            .find(|l| l.starts_with(&format!("{{\"key\":\"{key}\"")))
            .map(|l| l.trim_end_matches(',').to_string())
    };
    let mut json = Vec::new();
    let all = cells(size);
    let mut rendered = 0;
    for cell in &all {
        if !only.is_empty() && !only.contains(&cell.key) {
            if let Some(line) = line_of(&cell.key) {
                json.push(line);
                continue;
            }
        }
        rendered += 1;
        let mut scene = cell.scene.clone();
        let lens = scene
            .camera
            .lens
            .take()
            .map(|l| l.with_connections(cell.connect));
        scene.camera.lens = lens;
        let out = render_progressive(&scene, samples, threads, None);
        let rgb8 = out.to_rgb8(&cell.scene);
        let path = dir.join(format!("{}.png", cell.key));
        crate::write_png(&path, size.0, size.1, &rgb8)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        let stack: Vec<String> = cell
            .stack
            .iter()
            .map(|(k, g)| format!("{{\"kind\":{k},\"grade\":{g}}}"))
            .collect();
        json.push(format!(
            "{{\"key\":\"{}\",\"file\":\"{}.png\",\"stack\":[{}],\"connect\":{},\"samples\":{},\"rays\":{},\"seconds\":{:.2}}}",
            cell.key,
            cell.key,
            stack.join(","),
            cell.connect,
            out.samples,
            out.rays,
            out.elapsed.as_secs_f64()
        ));
        println!("{}: {:.1} s", cell.key, out.elapsed.as_secs_f64());
    }
    let index = format!(
        "{{\"width\":{},\"height\":{},\"cells\":[\n{}\n]}}\n",
        size.0,
        size.1,
        json.join(",\n")
    );
    std::fs::write(&path, index).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(rendered)
}

/// Size, samples and seeds of the noise measurement (`rt --filter-noise`): small and short,
/// so the variance between the seeds is large enough to read.
pub const NOISE_SIZE: (u32, u32) = (192, 144);
/// See [`NOISE_SIZE`].
pub const NOISE_SAMPLES: u32 = 16;
/// See [`NOISE_SIZE`].
pub const NOISE_RUNS: u32 = 6;
/// Pixel values are clamped here before the variance, so one firefly does not decide.
pub const NOISE_CLAMP: f32 = 64.0;

/// The filters of the noise measurement: none, the sparse kernels at grade 1 (star 6, streak,
/// glimmer), then white diffusion 1, black diffusion 2 and net 1.
pub fn noise_cases() -> Vec<(&'static str, FilterParams)> {
    vec![
        ("none", FilterParams::default()),
        ("star--1", one(FILTER_STAR, 1.0)),
        ("streak--1", one(FILTER_STREAK, 1.0)),
        ("glimmer--1", one(FILTER_GLIMMER, 1.0)),
        ("diffusion-white--1", one(FILTER_DIFFUSION_WHITE, 1.0)),
        ("diffusion-black--2", one(FILTER_DIFFUSION_BLACK, 2.0)),
        ("net--1", one(FILTER_NET, 1.0)),
    ]
}

/// The noise of one filter with or without its connections to the lights.
#[derive(Clone, Debug, PartialEq)]
pub struct Noise {
    /// Key of [`noise_cases`].
    pub key: String,
    /// Whether the filter connected to the lights.
    pub connect: bool,
    /// Mean of every channel of every pixel over the seeds (unclamped).
    pub mean: f64,
    /// Variance of a channel of a pixel between the seeds (values clamped at [`NOISE_CLAMP`]),
    /// averaged over the image.
    pub variance: f64,
    /// Rays traced by all the seeds' renders (camera, bounce and shadow rays): the cost, without
    /// the noise of a loaded machine in it.
    pub rays: u64,
    /// Seconds of all the seeds' renders.
    pub seconds: f64,
}

/// Mean and variance between `images` (the same render under different seeds), see [`Noise`].
pub fn seed_variance(images: &[Vec<f32>]) -> (f64, f64) {
    let runs = images.len();
    let n = images.first().map_or(0, Vec::len);
    if runs < 2 || n == 0 {
        return (0.0, 0.0);
    }
    let clamp = |v: f32| f64::from(v.min(NOISE_CLAMP));
    let mut mean = vec![0.0f64; n];
    for image in images {
        for (m, &v) in mean.iter_mut().zip(image) {
            *m += clamp(v);
        }
    }
    for m in &mut mean {
        *m /= runs as f64;
    }
    let mut variance = 0.0f64;
    for image in images {
        for (m, &v) in mean.iter().zip(image) {
            let d = clamp(v) - m;
            variance += d * d;
        }
    }
    variance /= (n * (runs - 1)) as f64;
    let total: f64 = images
        .iter()
        .flat_map(|image| image.iter().map(|&v| f64::from(v)))
        .sum();
    (total / (n * runs) as f64, variance)
}

/// Measures the noise of every case of [`noise_cases`] (or just `only`) on the sheet's bottle,
/// with and without the connections to the lights: `runs` renders under different seeds each,
/// written to `dir/noise.json`.
pub fn noise(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    runs: u32,
    threads: usize,
    only: &[String],
) -> Result<Vec<Noise>, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let none = FilterParams::default();
    let mut rows = Vec::new();
    for (key, filter) in noise_cases() {
        if !only.is_empty() && !only.iter().any(|k| k == key) {
            continue;
        }
        for connect in [false, true] {
            let mut images = Vec::new();
            let mut seconds = 0.0;
            let mut rays = 0;
            for run in 0..runs {
                let mut scene = filter_bottle(size, [filter, none, none]);
                scene.render.seed = 100 + run;
                let lens = scene
                    .camera
                    .lens
                    .take()
                    .map(|l| l.with_connections(connect));
                scene.camera.lens = lens;
                let out = render_progressive(&scene, samples, threads, None);
                seconds += out.elapsed.as_secs_f64();
                rays += out.rays;
                images.push(out.film.resolve());
            }
            let (mean, variance) = seed_variance(&images);
            println!(
                "{key}: {} connections, mean {mean:.4}, variance {variance:.3}, {rays} rays, {seconds:.1} s",
                if connect { "with" } else { "without" }
            );
            rows.push(Noise {
                key: key.into(),
                connect,
                mean,
                variance,
                rays,
                seconds,
            });
        }
    }
    let lines: Vec<String> = rows
        .iter()
        .map(|r| {
            format!(
                "{{\"key\":\"{}\",\"connect\":{},\"mean\":{:.5},\"variance\":{:.4},\"rays\":{},\"seconds\":{:.2}}}",
                r.key, r.connect, r.mean, r.variance, r.rays, r.seconds
            )
        })
        .collect();
    let json = format!(
        "{{\"width\":{},\"height\":{},\"samples\":{samples},\"runs\":{runs},\"clamp\":{},\"rows\":[\n{}\n]}}\n",
        size.0,
        size.1,
        NOISE_CLAMP,
        lines.join(",\n")
    );
    let path = dir.join("noise.json");
    std::fs::write(&path, json).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_has_every_kind_at_three_grades_two_stacks_and_none() {
        let cells = cells((32, 24));
        assert_eq!(cells.len(), 1 + 8 * 3 + 2 + 3);
        for (kind, _) in KINDS {
            assert_eq!(
                cells
                    .iter()
                    .filter(|c| c.connect && c.stack == [(kind, 1.0)])
                    .count(),
                1
            );
        }
        // The spot in the frame is in the frame, the other one is not.
        let scene = &cells[0].scene;
        let (forward, right, up) = scene.camera.basis();
        let half_w = 0.5 * scene.camera.sensor_mm / scene.camera.focal_mm;
        let seen = |p: Vec3| {
            let d = p - scene.camera.position;
            let z = d.dot(forward);
            (d.dot(right) / z).abs() < half_w && (d.dot(up) / z).abs() < half_w * 0.75
        };
        let n = scene.lights.len();
        assert!(seen(scene.lights[n - 2].position));
        assert!(!seen(scene.lights[n - 1].position));
    }

    /// The blue-to-red ratio of the floor in the sheet's bottom-left corner, far from both lights,
    /// through `filters`.
    fn floor_blue_over_red(filters: [FilterParams; 3]) -> f64 {
        let (w, h) = (128u32, 96u32);
        let out = render_progressive(&filter_bottle((w, h), filters), 16, 4, None);
        let rgb = out.film.resolve();
        let (mut r, mut b) = (0.0f64, 0.0f64);
        for y in (h * 85 / 100)..h {
            for x in 0..(w / 4) {
                let p = &rgb[((y * w + x) * 3) as usize..][..3];
                r += f64::from(p[0]);
                b += f64::from(p[2]);
            }
        }
        b / r
    }

    #[test]
    fn gold_and_streak_tint_their_halo_and_lines_and_hardly_the_floor_far_from_the_lights() {
        let none = FilterParams::default();
        let plain = floor_blue_over_red([none; 3]);
        for kind in [FILTER_DIFFUSION_GOLD, FILTER_STREAK] {
            for (grade, most) in [(1.0, 0.03), (2.0, 0.06)] {
                let ratio = floor_blue_over_red([one(kind, grade), none, none]);
                let shift = (ratio / plain - 1.0).abs();
                println!("kind {kind} grade {grade}: the floor's blue/red moves {shift:.4}");
                assert!(
                    shift < most,
                    "kind {kind} grade {grade}: the floor's blue/red moves {shift} ({ratio} against {plain})"
                );
            }
        }
    }

    #[test]
    fn the_star_and_the_net_have_the_lengths_of_the_verdict_on_the_sheet() {
        // The sheet's half-frame, degrees: a star's rays reach a quarter of it at 1/4, 60 % of it
        // at 1 and all of it at 2; the net's cross, at most 15 % of the frame's width at 2.
        let scene = filter_bottle((64, 48), [FilterParams::default(); 3]);
        let half = (0.5 * scene.camera.sensor_mm / scene.camera.focal_mm)
            .atan()
            .to_degrees();
        for (grade, share) in [(0.25, 0.25), (1.0, 0.6), (2.0, 1.0)] {
            let length = line_length_deg(FILTER_STAR, grade);
            assert!(
                (length / half / share - 1.0).abs() < 0.1,
                "grade {grade}: {length}° of a {half}° half-frame"
            );
        }
        assert!(line_length_deg(FILTER_NET, 2.0) <= 0.15 * 2.0 * half);
    }

    #[test]
    fn the_seed_variance_is_the_variance_between_the_runs_clamped() {
        // Two pixels, three runs: the first varies (1, 2, 3: variance 1), the second is a
        // firefly clamped to the same value every time (variance 0).
        let images = vec![vec![1.0, 100.0], vec![2.0, 200.0], vec![3.0, 300.0]];
        let (mean, variance) = seed_variance(&images);
        assert!((variance - 0.5).abs() < 1e-9, "{variance}");
        assert!((mean - 101.0).abs() < 1e-9, "{mean}");
        assert_eq!(seed_variance(&images[..1]), (0.0, 0.0));
    }

    #[test]
    fn the_noise_measurement_writes_both_rows_of_a_case() {
        let dir = std::env::temp_dir().join(format!("rt-filter-noise-{}", std::process::id()));
        let rows = noise(&dir, (16, 12), 1, 2, 2, &["star--1".into()]).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(!rows[0].connect && rows[1].connect);
        assert!(rows.iter().all(|r| r.key == "star--1" && r.mean > 0.0));
        // The connections trace shadow rays of their own.
        assert!(
            rows[1].rays > rows[0].rays,
            "{} {}",
            rows[0].rays,
            rows[1].rays
        );
        let json = std::fs::read_to_string(dir.join("noise.json")).unwrap();
        assert!(json.starts_with("{\"width\":16,\"height\":12,\"samples\":1,\"runs\":2,"));
        assert_eq!(json.matches("\"key\":\"star--1\"").count(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(noise_cases()[0].1, FilterParams::default());
    }
}

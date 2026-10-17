//! The guard against the synthetic "model" (ROADMAP X3a): every forbidden thing is detected and
//! corrected or rejected, and every guard step's test fails when that step is switched off.

use crate::checks::{colour_delta, high_band};
use crate::fixture::{self, Edit, Scene, FULL, H, W};
use crate::guard::Steps;
use crate::prepared::{Prepared, BACKGROUND};
use crate::*;
use crate::{FLOOR_ID, FLOOR_NAME};

fn run_steps(
    job: &Job,
    scene: &Scene,
    steps: Steps,
    model: &mut dyn FnMut(&TileRequest) -> Rgb8Image,
) -> (LinearImage, Report) {
    let mut plan = plan(job).expect("plan");
    plan.steps = steps;
    run_plan(&plan, &scene.image, &scene.passes(), model).expect("run")
}

fn run_with(
    job: &Job,
    scene: &Scene,
    model: fn(&TileRequest) -> Rgb8Image,
) -> (LinearImage, Report) {
    run_steps(job, scene, Steps::ALL, &mut |r| model(r))
}

fn without(f: impl Fn(&mut Steps)) -> Steps {
    let mut s = Steps::ALL;
    f(&mut s);
    s
}

/// Display-linear image of a result.
fn display(job: &Job, image: &LinearImage) -> Vec<f32> {
    image::Display::of(job).image(&image.rgba)
}

fn pixel(v: &[f32], x: u32, y: u32) -> [f32; 3] {
    let p = ((y * W + x) * 3) as usize;
    [v[p], v[p + 1], v[p + 2]]
}

fn lum(c: [f32; 3]) -> f32 {
    image::luma(&c)
}

#[test]
fn the_constants_are_the_contracts() {
    let ts = include_str!("../../../../src/core/ai.ts");
    let value = |name: &str| -> f32 {
        let line = ts
            .lines()
            .find(|l| l.contains(&format!("export const {name} = ")))
            .unwrap_or_else(|| panic!("{name} in src/core/ai.ts"));
        line.split('=')
            .nth(1)
            .unwrap()
            .trim()
            .trim_end_matches(';')
            .parse()
            .unwrap()
    };
    assert_eq!(value("MAX_STRENGTH"), MAX_STRENGTH);
    assert_eq!(value("MAX_ATTEMPTS"), MAX_ATTEMPTS as f32);
    assert_eq!(value("RETRY_FACTOR"), RETRY_FACTOR);
    // The defaults of the configurator.
    let d = Settings::DEFAULT;
    for (key, v) in [
        ("intervention", d.intervention),
        ("light", d.light),
        ("bounce", d.bounce),
        ("wear", d.wear),
        ("styleStrength", d.style_strength),
        ("seed", d.seed),
    ] {
        assert!(
            ts.contains(&format!("  {key}: {v},")),
            "DEFAULT_AI_PIPELINE.{key} = {v}"
        );
    }
    // C1: Intervention 50 and the colour and edge limits doubled (they were 30, and 2, 3 and 1.5).
    assert_eq!(d.intervention, 50);
    let t = Tolerances::PROVISIONAL;
    assert_eq!((t.delta_e_mean, t.delta_e_p95, t.edges_px), (4.0, 6.0, 3.0));
    // The colour limits are the factory values of Settings ▸ AI post-processing ▸ Advanced.
    let settings = include_str!("../../../../src/core/settings.ts");
    for (key, v) in [
        ("ai.guardDeltaE", t.delta_e_mean),
        ("ai.guardDeltaE95", t.delta_e_p95),
    ] {
        assert!(
            settings.contains(&format!("    '{key}': {v},")),
            "{key} = {v} in src/core/settings.ts"
        );
    }
}

#[test]
fn strengths_follow_intervention_and_the_retry_factor() {
    let mut s = Settings::DEFAULT;
    s.intervention = 50;
    let p = plan(&fixture::job(s)).unwrap();
    assert_eq!(p.strength(0), 0.5 * MAX_STRENGTH);
    assert_eq!(p.strength(1), 0.5 * RETRY_FACTOR * MAX_STRENGTH);
    assert_eq!(
        p.strength(2),
        0.5 * RETRY_FACTOR * RETRY_FACTOR * MAX_STRENGTH
    );
    assert_eq!(Plan::used_fraction(0), 1.0);
    assert_eq!(
        Plan::used_fraction(3),
        RETRY_FACTOR * RETRY_FACTOR * RETRY_FACTOR
    );
    s.intervention = 100;
    assert_eq!(plan(&fixture::job(s)).unwrap().strength(0), MAX_STRENGTH);
    // The JSON a host reads carries them.
    let json = p.to_json();
    assert!(
        json.contains("\"strengths\":[0.2,0.12,0.072,0.0432]"),
        "{json}"
    );
    assert!(json.contains("\"maxAttempts\":4"), "{json}");
    assert!(json.contains("\"deltaEMean\":4"), "{json}");
}

#[test]
fn intervention_zero_returns_the_input_bit_for_bit_without_the_model() {
    let scene = fixture::scene();
    let mut zero = FULL;
    zero.intervention = 0;
    // Every aspect at 0 with intervention up: nothing may change either.
    let mut aspects_off = Settings::NONE;
    aspects_off.intervention = 80;
    // Wear only, but no material allows it.
    let mut wear_nowhere = aspects_off;
    wear_nowhere.wear = 100;
    for (i, settings) in [zero, aspects_off, wear_nowhere].into_iter().enumerate() {
        let mut job = fixture::job(settings);
        if i == 2 {
            job.materials.iter_mut().for_each(|m| m.allows_wear = false);
        }
        let p = plan(&job).unwrap();
        assert!(
            p.tiles.is_empty() && !p.runs_model(),
            "case {i}: zero tiles to run"
        );
        let (image, report) = run_steps(&job, &scene, Steps::ALL, &mut |_| panic!("the model ran"));
        assert_eq!(image.width, W);
        let same = image
            .rgba
            .iter()
            .zip(&scene.image.rgba)
            .all(|(a, b)| a.to_bits() == b.to_bits());
        assert!(same, "case {i}: bit for bit");
        assert_eq!(report.verdict, Verdict::Accepted);
        assert_eq!(report.attempts, 0);
        assert_eq!(report.used_fraction, 1.0);
        assert!(report.all_ok());
    }
}

#[test]
fn the_output_is_always_the_jobs_size() {
    for (w, h) in [(1u32, 1u32), (17, 9), (300, 200), (1025, 33), (64, 2100)] {
        let n = (w * h) as usize;
        let mut image = LinearImage::new(w, h);
        for (i, v) in image.rgba.iter_mut().enumerate() {
            *v = if i % 4 == 3 {
                1.0
            } else {
                ((i * 37) % 997) as f32 / 1000.0
            };
        }
        let part = vec![1u32; n];
        let passes = Passes {
            width: w,
            height: h,
            part_id: &part,
            material_id: &part,
            normal: None,
            depth: None,
            coc: None,
        };
        let job = Job::new(w, h, FULL);
        let p = plan(&job).unwrap();
        for t in &p.tiles {
            assert_eq!(t.padded_width % PAD_MULTIPLE, 0);
            assert_eq!(t.padded_height % PAD_MULTIPLE, 0);
            assert!(t.x + t.width <= w && t.y + t.height <= h);
        }
        // A model that brightens: the result is still exactly the job's size.
        let (out, report) = run(&job, &image, &passes, |r| Rgb8Image {
            width: r.input.width,
            height: r.input.height,
            rgb: r.input.rgb.iter().map(|&b| b.saturating_add(9)).collect(),
        })
        .unwrap();
        assert_eq!(
            (out.width, out.height, out.rgba.len()),
            (w, h, n * 4),
            "{w}x{h}"
        );
        assert!(report.size.ok, "{w}x{h}");
    }
}

#[test]
fn an_identity_model_changes_nothing_across_tiles() {
    let scene = fixture::scene();
    let job = fixture::job(FULL);
    assert_eq!(plan(&job).unwrap().tiles.len(), 2);
    let (image, report) = run_with(&job, &scene, fixture::identity);
    assert_eq!(report.verdict, Verdict::Accepted, "{report:?}");
    assert!(image
        .rgba
        .iter()
        .zip(&scene.image.rgba)
        .all(|(a, b)| a.to_bits() == b.to_bits()));
}

#[test]
fn the_model_sees_the_engine_image_and_the_exact_passes() {
    let scene = fixture::scene();
    let job = fixture::job(Settings::DEFAULT);
    let p = plan(&job).unwrap();
    let display = image::Display::of(&job);
    let input = tile_input(&p, &scene.image, 1).unwrap();
    let t = p.tiles[1];
    assert_eq!(
        (input.width, input.height),
        (t.padded_width, t.padded_height)
    );
    // A pixel of the tile, and a padded row (the last real row repeated).
    for (i, j, x, y) in [
        (5u32, 7u32, t.x + 5, 7u32),
        (9, t.padded_height - 1, t.x + 9, H - 1),
    ] {
        let q = (y * W + x) as usize * 4;
        let px = &scene.image.rgba[q..q + 4];
        let want = display.apply(px[0], px[1], px[2]).map(image::encode8);
        let at = ((j * input.width + i) * 3) as usize;
        assert_eq!(input.rgb[at..at + 3], want);
    }
    let controls = conditioning(&p, &scene.passes()).unwrap();
    assert_eq!(controls.len(), 2);
    let c0 = &controls[0];
    // The crease at x = 330 (between columns 329 and 330) is an edge; the body's flat inside is not.
    let at = |c: &TileControl, x: u32, y: u32| c.edges[(y * c.width + x) as usize];
    assert_eq!(at(c0, 329, 100), 255);
    assert_eq!(at(c0, 330, 100), 255);
    assert_eq!(at(c0, 250, 100), 0);
    // Depth: the cap (700) is the nearest surface, the body's far end the farthest.
    let c1 = &controls[1];
    assert_eq!(c1.depth[(170 * c1.width + 860 - t.x) as usize], 255);
    assert_eq!(c0.depth[(100 * c0.width + 559) as usize], DEPTH_FAR);
    assert_eq!(
        c0.depth[(10 * c0.width + 10) as usize],
        0,
        "background is black"
    );
}

/// The worst edge displacement and other checks of a result, measured afresh.
fn checks_of(job: &Job, scene: &Scene, image: &LinearImage, attempt: u32) -> checks::Measures {
    let p = plan(job).unwrap();
    let prep = Prepared::new(job, &scene.image, scene.passes());
    let disp = display(job, image);
    let caps = prepared::Caps::of(job, p.scale(attempt));
    checks::measure(&prep, &image.rgba, &disp, &caps)
}

fn shifted(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    fixture::shift(&mut e, 3);
    fixture::ramp(&mut e, 24);
    e.done()
}

#[test]
fn a_moved_edge_does_not_move_the_result() {
    let scene = fixture::scene();
    let job = fixture::job(FULL);
    let (image, report) = run_with(&job, &scene, shifted);
    assert_eq!(report.verdict, Verdict::Accepted, "{:?}", report.reason);
    assert!(report.edges.value <= 0.25, "edges {}", report.edges.value);
    // The light ramp went through.
    let disp = display(&job, &image);
    let before = fixture::scene();
    let d0 = display(&job, &before.image);
    assert!(lum(pixel(&disp, 540, 150)) > lum(pixel(&d0, 540, 150)) * 1.01);
    // Switched off, the transfer or the separation would let the edge move: the checks reject it.
    for steps in [
        without(|s| s.transfer = false),
        without(|s| s.bands = false),
    ] {
        let (image, report) = run_steps(&job, &scene, steps, &mut |r| shifted(r));
        assert_eq!(report.verdict, Verdict::Rejected, "{steps:?}");
        assert!(!report.edges.ok, "{steps:?}: {}", report.edges.value);
        assert_eq!(image, scene.image, "a rejection delivers the engine image");
    }
}

fn tinted(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    fixture::tint(&mut e, fixture::cap_area);
    e.done()
}

#[test]
fn a_material_colour_change_is_limited_to_the_tolerance() {
    let scene = fixture::scene();
    // Caps that let more colour through than the ΔE tolerance: the regions step must limit it.
    let mut job = fixture::job(FULL);
    job.tolerances.cap_bounce = 0.5;
    let (image, report) = run_with(&job, &scene, tinted);
    assert_eq!(report.verdict, Verdict::Accepted, "{:?}", report.reason);
    let cap = report.materials.iter().find(|m| m.name == "Cap").unwrap();
    assert!(
        cap.ok
            && cap.delta_e_mean <= job.tolerances.delta_e_mean
            && cap.delta_e_p95 <= job.tolerances.delta_e_p95,
        "{cap:?}"
    );
    assert!(
        report
            .reason
            .as_deref()
            .unwrap_or("")
            .contains("colour change of Cap kept to"),
        "{:?}",
        report.reason
    );
    // Some colour change was let through, within the limit.
    let (d0, d1) = (display(&job, &scene.image), display(&job, &image));
    let (a, b) = (pixel(&d0, 860, 170), pixel(&d1, 860, 170));
    assert!(b[0] / b[2] > a[0] / a[2] * 1.005, "{a:?} -> {b:?}");
    // Without the regions step the full capped tint goes through: the colour check fails (and the
    // background around the cap changes too).
    let mut p = plan(&job).unwrap();
    p.steps = without(|s| s.regions = false);
    let outputs: Vec<Rgb8Image> = (0..p.tiles.len())
        .map(|i| {
            let input = tile_input(&p, &scene.image, i).unwrap();
            let control = &conditioning(&p, &scene.passes()).unwrap()[i];
            tinted(&TileRequest {
                index: i,
                tile: &p.tiles[i],
                input: &input,
                control,
                strength: p.strength(0),
                attempt: 0,
                seed: 0,
            })
        })
        .collect();
    match accept(&p, &scene.image, &scene.passes(), &outputs, 0).unwrap() {
        Outcome::Retry { reason, .. } => {
            assert!(reason.contains("colour of Cap changed"), "{reason}");
            assert!(reason.contains("outside the allowed regions"), "{reason}");
        }
        other => panic!("{other:?}"),
    }
}

fn blurred(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    fixture::blur(&mut e, fixture::body_area);
    fixture::blur(&mut e, fixture::body_area);
    e.done()
}

fn sharpened(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    fixture::sharpen(&mut e, fixture::cap_area);
    e.done()
}

#[test]
fn blurring_what_is_in_focus_is_undone() {
    let scene = fixture::scene();
    let job = fixture::job(FULL);
    let (image, report) = run_with(&job, &scene, blurred);
    assert_eq!(report.verdict, Verdict::Accepted, "{:?}", report.reason);
    assert!(report.focus.ok && report.detail.ok, "{report:?}");
    // The label's text stripes keep their contrast (in the scene image: the tone curve is the
    // render's own business).
    let contrast = |img: &LinearImage| {
        let l = |x: u32| {
            let q = ((170 * W + x) * 4) as usize;
            lum([img.rgba[q], img.rgba[q + 1], img.rgba[q + 2]])
        };
        l(455) / l(452)
    };
    assert!(contrast(&scene.image) > 3.0);
    assert!((contrast(&image) / contrast(&scene.image) - 1.0).abs() < 0.03);
    let (_, report) = run_steps(&job, &scene, without(|s| s.transfer = false), &mut |r| {
        blurred(r)
    });
    assert_eq!(report.verdict, Verdict::Rejected);
    assert!(!report.focus.ok && !report.detail.ok, "{report:?}");
}

#[test]
fn sharpening_what_is_out_of_focus_is_undone() {
    let scene = fixture::scene();
    let job = fixture::job(FULL);
    let (_, report) = run_with(&job, &scene, sharpened);
    assert_eq!(report.verdict, Verdict::Accepted, "{:?}", report.reason);
    assert!(report.focus.value < 0.05, "{}", report.focus.value);
    let (_, report) = run_steps(&job, &scene, without(|s| s.transfer = false), &mut |r| {
        sharpened(r)
    });
    assert_eq!(report.verdict, Verdict::Rejected);
    assert!(!report.focus.ok, "{}", report.focus.value);
}

fn background(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    fixture::band(&mut e, 0, 30);
    e.done()
}

#[test]
fn the_background_and_locked_materials_never_change() {
    let scene = fixture::scene();
    let job = fixture::job(FULL);
    // The model brightens everything, the background included.
    let (image, report) = run_with(&job, &scene, background);
    assert_eq!(report.verdict, Verdict::Accepted, "{:?}", report.reason);
    assert_eq!(report.outside.value, 0.0);
    let mut changed_surface = 0;
    for p in 0..(W * H) as usize {
        let same = (0..4)
            .all(|c| image.rgba[p * 4 + c].to_bits() == scene.image.rgba[p * 4 + c].to_bits());
        if scene.part[p] == 0 || scene.material[p] == fixture::LED {
            assert!(same, "pixel {p} changed");
        } else if !same {
            changed_surface += 1;
        }
    }
    assert!(
        changed_surface > 50_000,
        "the surfaces did brighten: {changed_surface}"
    );
    let (_, report) = run_steps(&job, &scene, without(|s| s.regions = false), &mut |r| {
        background(r)
    });
    assert_eq!(report.verdict, Verdict::Rejected);
    assert!(report.outside.value > 100_000.0, "{}", report.outside.value);
}

#[test]
fn another_size_is_rejected_and_the_engine_image_delivered() {
    let scene = fixture::scene();
    let job = fixture::job(Settings::DEFAULT);
    for (dw, dh) in [(16u32, 0u32), (0, 16)] {
        let mut calls = 0;
        let (image, report) = run_steps(&job, &scene, Steps::ALL, &mut |r| {
            calls += 1;
            Rgb8Image {
                width: r.input.width + dw,
                height: r.input.height + dh,
                rgb: vec![128; ((r.input.width + dw) * (r.input.height + dh) * 3) as usize],
            }
        });
        assert_eq!(
            calls, 2,
            "one attempt: a lower strength would not change the size"
        );
        assert_eq!(image, scene.image);
        assert_eq!(report.verdict, Verdict::Rejected);
        assert!(!report.size.ok && report.size.value == 0.0);
        assert_eq!(report.used_fraction, 0.0);
        assert!(report.reason.unwrap().contains("came back"));
    }
    // The right size but too few bytes is the same failure, not a crash.
    let p = plan(&job).unwrap();
    let mut outputs: Vec<Rgb8Image> = (0..2)
        .map(|i| tile_input(&p, &scene.image, i).unwrap())
        .collect();
    outputs[1].rgb.pop();
    let outcome = accept(&p, &scene.image, &scene.passes(), &outputs, 0).unwrap();
    assert!(matches!(outcome, Outcome::Rejected { .. }));
    // Wrong counts and attempts are errors of the caller.
    assert!(accept(&p, &scene.image, &scene.passes(), &outputs[..1], 0).is_err());
    assert!(accept(&p, &scene.image, &scene.passes(), &outputs, MAX_ATTEMPTS).is_err());
}

/// Log-luminance change of a pixel.
fn dlum(d0: &[f32], d1: &[f32], x: u32, y: u32) -> f32 {
    image::ln_eps(lum(pixel(d1, x, y))) - image::ln_eps(lum(pixel(d0, x, y)))
}

fn local_light(r: &TileRequest) -> Rgb8Image {
    // The left of the body brighter, the rest as it was: no change common to the image.
    let mut e = Edit::of(r);
    e.map(|e, x, _, i, j, c| {
        let v = e.get(i, j, c);
        if (100..250).contains(&x) {
            v * 23 / 20
        } else {
            v
        }
    });
    e.done()
}

fn global_warm(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    e.map(|e, _, _, i, j, c| e.get(i, j, c) + [12, 0, -12][c]);
    e.done()
}

#[test]
fn each_control_at_zero_leaves_its_aspect_unchanged() {
    let scene = fixture::scene();
    let d0 = display(&fixture::job(FULL), &scene.image);
    let with = |f: fn(&mut Settings)| {
        let mut s = FULL;
        f(&mut s);
        fixture::job(s)
    };
    // Light: a local luminance change passes at 100 and not at all at 0.
    let (on, _) = run_with(&with(|_| ()), &scene, local_light);
    let (off, _) = run_with(&with(|s| s.light = 0), &scene, local_light);
    assert_ne!(on, off);
    let (d_on, d_off) = (display(&with(|_| ()), &on), display(&with(|_| ()), &off));
    assert!(dlum(&d0, &d_on, 200, 150) > 0.03);
    for (x, y) in [(200, 150), (450, 250), (800, 170)] {
        assert!(dlum(&d0, &d_off, x, y).abs() < 2.0e-3, "light 0 at {x},{y}");
    }
    // Bounce: a local colour change passes at 100 and not at all at 0.
    let (on, _) = run_with(&with(|s| s.wear = 0), &scene, tinted);
    let (off, _) = run_with(&with(|s| s.bounce = 0), &scene, tinted);
    // (The colour of the scene light: a grey gain keeps it, whatever the tone curve shows.)
    let ratio = |img: &LinearImage| {
        let q = ((170 * W + 860) * 4) as usize;
        img.rgba[q] / img.rgba[q + 2]
    };
    assert!(ratio(&on) > ratio(&scene.image) * 1.005);
    assert!(
        (ratio(&off) / ratio(&scene.image) - 1.0).abs() < 1.0e-3,
        "bounce 0"
    );
    // Style: a change common to the whole image passes at 100 and not at all at 0 (Bounce at 0,
    // or what of it varies from place to place would pass as local colour).
    let (on, _) = run_with(&with(|s| s.bounce = 0), &scene, global_warm);
    let (off, _) = run_with(
        &with(|s| {
            s.bounce = 0;
            s.style_strength = 0
        }),
        &scene,
        global_warm,
    );
    let common_warmth = |img: &LinearImage| {
        let mut hist = prepared::Histogram::new(-1.0, 1.0, 8192);
        for p in 0..(W * H) as usize {
            if scene.part[p] != 0 && scene.material[p] != fixture::LED {
                let (o, n) = (&scene.image.rgba[p * 4..], &img.rgba[p * 4..]);
                hist.add(checks::log_ratio(o[0], n[0]) - checks::log_ratio(o[2], n[2]));
            }
        }
        hist.quantile(0.5)
    };
    assert!(common_warmth(&on) > 0.02, "{}", common_warmth(&on));
    assert!(
        common_warmth(&off).abs() < 1.0e-3,
        "style 0: {}",
        common_warmth(&off)
    );
}

fn worn(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    fixture::pattern(&mut e, 12, fixture::everywhere);
    e.done()
}

/// How much of the wear pattern (`fixture::pattern`) entered the result inside a rectangle: the
/// mean of the scene log-luminance change times the pattern's sign.
fn mid_energy(
    job: &Job,
    scene: &Scene,
    image: &LinearImage,
    xs: (u32, u32),
    ys: (u32, u32),
) -> f32 {
    let prep = Prepared::new(job, &scene.image, scene.passes());
    let (l1, _) = high_band(&prep, &image.rgba);
    let (l0, _) = high_band(&prep, prep.orig);
    let (mut e, mut n) = (0.0f32, 0.0f32);
    for y in ys.0..ys.1 {
        for x in xs.0..xs.1 {
            let p = (y * W + x) as usize;
            let sign = if ((x / 8) + (y / 8)) % 2 == 0 {
                1.0
            } else {
                -1.0
            };
            e += (l1[p] - l0[p]) * sign;
            n += 1.0;
        }
    }
    (e / n).abs()
}

#[test]
fn wear_enters_only_materials_that_allow_it_in_focus() {
    let scene = fixture::scene();
    let job = fixture::job(FULL);
    let (image, report) = run_with(&job, &scene, worn);
    assert_eq!(report.verdict, Verdict::Accepted, "{:?}", report.reason);
    let body = mid_energy(&job, &scene, &image, (150, 300), (100, 250));
    let label = mid_energy(&job, &scene, &image, (400, 500), (125, 145));
    let cap = mid_energy(&job, &scene, &image, (820, 900), (130, 210));
    assert!(body > 0.01, "the body takes wear: {body}");
    assert!(label < body * 0.05, "the label does not: {label} vs {body}");
    assert!(
        cap < body * 0.05,
        "the cap (out of focus) does not: {cap} vs {body}"
    );
    // Wear at 0: nothing of the pattern enters the body either.
    let mut no_wear = FULL;
    no_wear.wear = 0;
    let job0 = fixture::job(no_wear);
    let (image0, _) = run_with(&job0, &scene, worn);
    let body0 = mid_energy(&job0, &scene, &image0, (150, 300), (100, 250));
    assert!(body0 < body * 0.05, "wear 0: {body0} vs {body}");
    // Without the frequency separation the pattern would enter the label too, and the checks
    // reject it.
    let (image, report) = run_steps(&job, &scene, without(|s| s.bands = false), &mut |r| worn(r));
    assert_eq!(report.verdict, Verdict::Rejected);
    assert!(report.reason.unwrap().contains("detail SSIM"));
    assert_eq!(image, scene.image);
}

#[test]
fn a_failing_check_lowers_the_strength_until_it_passes() {
    let scene = fixture::scene();
    // A light ramp moves the edge peaks by a fraction of a pixel; at the default limit it passes.
    let ramped = |r: &TileRequest| {
        let mut e = Edit::of(r);
        // Stronger at higher strength, like a real img2img model.
        let amount = (60.0 * r.strength / MAX_STRENGTH) as i32;
        fixture::ramp(&mut e, amount);
        fixture::band(&mut e, 0, amount / 3);
        e.done()
    };
    let job = fixture::job(FULL);
    let (_, first) = run(&job, &scene.image, &scene.passes(), ramped).unwrap();
    assert_eq!(first.verdict, Verdict::Accepted);
    let v0 = first.edges.value;
    assert!(v0 > 0.0, "the ramp shifts the peaks a little: {v0}");
    // With the limit just below that, the first attempt fails and a weaker one passes.
    let mut tight = job.clone();
    tight.tolerances.edges_px = v0 * 0.9;
    let mut strengths = Vec::new();
    let (image, report) = run(&tight, &scene.image, &scene.passes(), |r| {
        if r.index == 0 {
            strengths.push(r.strength);
        }
        ramped(r)
    })
    .unwrap();
    assert_eq!(report.verdict, Verdict::Limited, "{report:?}");
    assert!(report.attempts >= 2);
    assert_eq!(
        report.used_fraction,
        Plan::used_fraction(report.attempts - 1)
    );
    let p = plan(&tight).unwrap();
    let want: Vec<f32> = (0..report.attempts).map(|a| p.strength(a)).collect();
    assert_eq!(strengths, want);
    assert!(report.reason.unwrap().contains("strength lowered"));
    assert_ne!(image, scene.image);
    // With a limit no attempt can meet, every attempt is made and the engine image delivered.
    let mut impossible = job.clone();
    impossible.tolerances.edges_px = 0.0;
    let mut calls = 0;
    let (image, report) = run(&impossible, &scene.image, &scene.passes(), |r| {
        calls += 1;
        ramped(r)
    })
    .unwrap();
    assert_eq!(calls, 2 * MAX_ATTEMPTS);
    assert_eq!(report.verdict, Verdict::Rejected);
    assert_eq!(report.attempts, MAX_ATTEMPTS);
    assert_eq!(image, scene.image);
    assert!(report.reason.unwrap().starts_with("no attempt passed"));
}

/// An edit of one RGBA pixel: the pixel, its index and its coordinates.
type PixelEdit<'a> = dyn Fn(&mut [f32], usize, u32, u32) + 'a;

#[test]
fn the_checks_catch_each_forbidden_change_on_their_own() {
    // The checks measure results however they were made: hand-made ones here.
    let scene = fixture::scene();
    let job = fixture::job(FULL);
    let tol = job.tolerances;
    let base = checks_of(&job, &scene, &scene.image, 0);
    assert_eq!(base.outside, 0);
    assert_eq!(base.edges, 0.0);
    assert!((base.detail - 1.0).abs() < 1e-6 && base.focus == 0.0);
    assert!(base.colour.iter().all(|&(m, p)| m == 0.0 && p == 0.0));

    let edit = |f: &PixelEdit<'_>| {
        let mut img = scene.image.clone();
        for y in 0..H {
            for x in 0..W {
                let p = (y * W + x) as usize;
                f(&mut img.rgba[p * 4..p * 4 + 4], p, x, y);
            }
        }
        img
    };
    // A moved edge (the whole image three pixels to the right).
    let src = scene.image.rgba.clone();
    let moved = edit(&|px, p, x, _| {
        if x >= 3 {
            px.copy_from_slice(&src[(p - 3) * 4..(p - 3) * 4 + 4]);
        }
    });
    let m = checks_of(&job, &scene, &moved, 0);
    assert!(m.edges > tol.edges_px, "{}", m.edges);
    assert!(m.outside > 0);
    // A material colour change.
    let tinted = edit(&|px, p, _, _| {
        if scene.material[p] == fixture::CAP {
            px[0] *= 1.3;
            px[2] *= 0.7;
        }
    });
    let m = checks_of(&job, &scene, &tinted, 0);
    let cap = (fixture::CAP - 1) as usize;
    assert!(m.colour[cap].0 > tol.delta_e_mean, "{:?}", m.colour[cap]);
    assert_eq!(m.colour[0], (0.0, 0.0), "the body did not change");
    // Blurred in focus: the label's stripes averaged.
    let blurred = edit(&|px, p, x, y| {
        if scene.material[p] == fixture::LABEL && x > 0 && x + 1 < W && y > 0 {
            for c in 0..3 {
                px[c] = (src[(p - 1) * 4 + c] + src[p * 4 + c] + src[(p + 1) * 4 + c]) / 3.0;
            }
        }
    });
    let m = checks_of(&job, &scene, &blurred, 0);
    assert!(m.focus > tol.focus && m.detail < tol.detail_ssim, "{m:?}");
    // Sharpened out of focus: noise added on the cap.
    let sharpened = edit(&|px, p, x, y| {
        if scene.material[p] == fixture::CAP {
            let s = if (x + y) % 2 == 0 { 1.15 } else { 0.87 };
            px[0] *= s;
            px[1] *= s;
            px[2] *= s;
        }
    });
    let m = checks_of(&job, &scene, &sharpened, 0);
    assert!(m.focus > tol.focus, "{}", m.focus);
    // The background or a locked material touched.
    let touched = edit(&|px, p, _, _| {
        if scene.part[p] == 0 && p % 7 == 0 || scene.material[p] == fixture::LED && p % 5 == 0 {
            px[1] += 0.001;
        }
    });
    let m = checks_of(&job, &scene, &touched, 0);
    assert!(m.outside > 1000, "{}", m.outside);
}

#[test]
fn the_colour_measure_is_ciede2000_of_what_is_not_allowed() {
    let job = fixture::job(Settings::DEFAULT);
    let d = image::Display::of(&job);
    let show = |c: [f32; 3]| d.apply(c[0], c[1], c[2]);
    let a = [0.5f32, 0.25, 0.1];
    assert_eq!(colour_delta(&d, a, show(a), a, show(a), [0.0; 3], 0.0), 0.0);
    let b = [0.25f32, 0.5, 0.1];
    let direct = color::delta_e_2000(color::lab(show(a)), color::lab(show(b)));
    assert_eq!(
        colour_delta(&d, a, show(a), b, show(b), [0.0; 3], 0.0),
        direct
    );
}

#[test]
fn the_guard_is_deterministic() {
    let scene = fixture::scene();
    let job = fixture::job(Settings::DEFAULT);
    let (a, ra) = run_with(&job, &scene, fixture::forbidden);
    let (b, rb) = run_with(&job, &scene, fixture::forbidden);
    assert_eq!(fixture::fnv_f32(&a.rgba), fixture::fnv_f32(&b.rgba));
    assert_eq!(ra.to_json(), rb.to_json());
}

#[test]
fn every_forbidden_thing_at_once_is_guarded() {
    let scene = fixture::scene();
    for settings in [Settings::DEFAULT, FULL] {
        let job = fixture::job(settings);
        let (image, report) = run_with(&job, &scene, fixture::forbidden);
        assert_ne!(
            report.verdict,
            Verdict::Rejected,
            "{settings:?}: {:?}",
            report.reason
        );
        assert!(report.all_ok());
        for p in 0..(W * H) as usize {
            if scene.part[p] == 0 {
                assert_eq!(
                    image.rgba[p * 4].to_bits(),
                    scene.image.rgba[p * 4].to_bits()
                );
            }
        }
        let prep = Prepared::new(&job, &scene.image, scene.passes());
        assert!(prep.region.contains(&BACKGROUND));
    }
}

// --- The studio floor (AI-POST.md §7.4, the lead's correction after X4) ---

/// The fixture with the background below the objects turned into the studio floor (both ids
/// FLOOR_ID, facing up, receding): a surface, not background.
fn floor_scene() -> fixture::Scene {
    let mut scene = fixture::scene();
    for y in 290..H {
        for x in 0..W {
            let p = (y * W + x) as usize;
            if scene.part[p] == 0 {
                scene.part[p] = FLOOR_ID;
                scene.material[p] = FLOOR_ID;
                scene.normal[p * 3..p * 3 + 3].copy_from_slice(&[0.0, 0.0, 1.0]);
                scene.depth[p] = 3000.0 - y as f32;
            }
        }
    }
    scene
}

/// Turns the floor blue (it starts below row 290 and wherever the passes say).
fn blue_floor(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    e.map(|e, _, y, i, j, c| {
        let v = e.get(i, j, c);
        if y < 292 {
            v
        } else if c == 2 {
            v + 60
        } else {
            v - 30
        }
    });
    e.done()
}

#[test]
fn a_floor_seen_first_is_a_region_like_any_other() {
    // The floor in the first rows, a part below: FLOOR_ID is u32::MAX, which once also stood for
    // "no material looked up yet", and the floor seen first fell into the background.
    let (w, h) = (8u32, 4u32);
    let n = (w * h) as usize;
    let mut part = vec![FLOOR_ID; n];
    let mut material = vec![FLOOR_ID; n];
    for p in n / 2..n {
        part[p] = 1;
        material[p] = 1;
    }
    let image = LinearImage {
        width: w,
        height: h,
        rgba: vec![0.25; n * 4],
    };
    let passes = Passes {
        width: w,
        height: h,
        part_id: &part,
        material_id: &material,
        normal: None,
        depth: None,
        coc: None,
    };
    let job = Job::new(w, h, FULL);
    let prep = Prepared::new(&job, &image, passes);
    let open = prep.open_mask();
    for (p, &r) in prep.region.iter().enumerate().take(n / 2) {
        assert_ne!(r, BACKGROUND, "floor pixel {p} is background");
        let region = &prep.regions[r as usize];
        assert_eq!(
            (
                region.id,
                region.name.as_str(),
                region.allows_wear,
                region.locked
            ),
            (FLOOR_ID, FLOOR_NAME, false, false)
        );
        assert!(open[p], "floor pixel {p} may be relit");
    }
    assert!(prep.region[n / 2..]
        .iter()
        .all(|&r| prep.regions[r as usize].id == 1));
}

#[test]
fn the_floor_is_relit_and_colour_checked_never_background() {
    let scene = floor_scene();
    let job = fixture::job(FULL);
    // The model brightens everything: the floor brightens with the objects, the background stays.
    let (image, report) = run_with(&job, &scene, background);
    assert_eq!(report.verdict, Verdict::Accepted, "{:?}", report.reason);
    assert_eq!(report.outside.value, 0.0);
    let (mut floor, mut lit) = (0, 0);
    for p in 0..(W * H) as usize {
        let same = (0..4)
            .all(|c| image.rgba[p * 4 + c].to_bits() == scene.image.rgba[p * 4 + c].to_bits());
        match scene.part[p] {
            0 => assert!(same, "background pixel {p} changed"),
            FLOOR_ID => {
                floor += 1;
                if image.rgba[p * 4 + 1] > scene.image.rgba[p * 4 + 1] {
                    lit += 1;
                }
            }
            _ => {}
        }
    }
    assert!(floor > 40_000, "{floor}");
    assert!(
        lit * 10 > floor * 9,
        "the floor brightened: {lit} of {floor}"
    );
    // Its own colour check, by name.
    let check = report
        .materials
        .iter()
        .find(|m| m.material_id == FLOOR_ID)
        .expect("the floor's colour check");
    assert_eq!(check.name, FLOOR_NAME);
    assert!(check.ok, "{check:?}");
    // A model that turns the floor blue: the floor's own ΔE limits how much of it goes through.
    let mut loose = job.clone();
    loose.tolerances.cap_bounce = 0.5;
    let (image, report) = run_with(&loose, &scene, blue_floor);
    assert_ne!(report.verdict, Verdict::Rejected, "{:?}", report.reason);
    let check = report
        .materials
        .iter()
        .find(|m| m.material_id == FLOOR_ID)
        .unwrap();
    assert!(
        check.ok
            && check.delta_e_mean <= loose.tolerances.delta_e_mean
            && check.delta_e_p95 <= loose.tolerances.delta_e_p95,
        "{check:?}"
    );
    assert!(
        report
            .reason
            .as_deref()
            .unwrap_or("")
            .contains("colour change of Floor kept to"),
        "{:?}",
        report.reason
    );
    let (d0, d1) = (display(&job, &scene.image), display(&job, &image));
    let (a, b) = (pixel(&d0, 40, 320), pixel(&d1, 40, 320));
    assert!(
        b[2] / b[0] > a[2] / a[0],
        "some blue went through: {a:?} -> {b:?}"
    );
}

// --- The fixture shared with the WebAssembly parity test (tests/ai-post-wasm.test.ts) ---

/// A synthetic model.
type Model = fn(&TileRequest) -> Rgb8Image;

/// The scenarios of `tests/fixtures/ai-guard.json`, in order: name, job, model.
pub(crate) fn scenarios() -> Vec<(&'static str, Job, Model)> {
    let mut untouched = FULL;
    untouched.intervention = 0;
    let mut limited = fixture::job(FULL);
    limited.tolerances.edges_px = LIMITED_EDGES_PX;
    vec![
        ("untouched", fixture::job(untouched), fixture::forbidden),
        (
            "forbidden",
            fixture::job(Settings::DEFAULT),
            fixture::forbidden,
        ),
        ("strong", fixture::job(FULL), fixture::forbidden),
        ("limited", limited, limited_model),
        ("rejected", fixture::job(Settings::DEFAULT), wrong_size),
    ]
}

/// The edge limit of the "limited" scenario: below what its first attempt measures.
pub(crate) const LIMITED_EDGES_PX: f32 = 0.005;

fn limited_model(r: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(r);
    let amount = [60, 36, 21, 12][r.attempt as usize];
    fixture::ramp(&mut e, amount);
    e.done()
}

fn wrong_size(r: &TileRequest) -> Rgb8Image {
    Rgb8Image {
        width: r.input.width + 16,
        height: r.input.height,
        rgb: vec![0; ((r.input.width + 16) * r.input.height * 3) as usize],
    }
}

/// The fixture's JSON: per scenario, the hash of the delivered image, the hash of everything the
/// model was given (inputs, edges, depth of every tile) and the report.
pub(crate) fn fixture_json() -> String {
    let scene = fixture::scene();
    let mut out = String::from("{\"scenarios\":[\n");
    for (i, (name, job, model)) in scenarios().into_iter().enumerate() {
        let p = plan(&job).unwrap();
        let mut given = 0x811c_9dc5u32;
        for t in 0..p.tiles.len() {
            given = fixture::fnv_bytes(given, &tile_input(&p, &scene.image, t).unwrap().rgb);
        }
        for c in conditioning(&p, &scene.passes()).unwrap() {
            given = fixture::fnv_bytes(given, &c.edges);
            given = fixture::fnv_bytes(given, &c.depth);
        }
        let (image, report) = run_with(&job, &scene, model);
        out.push_str(&format!(
            "{}{{\"name\":\"{name}\",\"tiles\":{},\"imageHash\":\"0x{:08x}\",\"givenHash\":\"0x{:08x}\",\"report\":{}}}",
            if i == 0 { "" } else { ",\n" },
            p.tiles.len(),
            fixture::fnv_f32(&image.rgba),
            given,
            report.to_json()
        ));
    }
    out.push_str("\n]}\n");
    out
}

#[test]
fn the_fixture_report_is_the_checked_in_one() {
    let json = fixture_json();
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/ai-guard.json"
    );
    if std::env::var_os("REPACK_WRITE_FIXTURES").is_some() {
        std::fs::write(path, &json).expect("write the fixture");
    }
    let pinned = std::fs::read_to_string(path).unwrap_or_default();
    assert_eq!(
        json, pinned,
        "tests/fixtures/ai-guard.json is stale: REPACK_WRITE_FIXTURES=1 cargo test -p rt-post"
    );
    // The scenarios end as they are meant to.
    for (name, verdict) in [
        ("untouched", "ACCEPTED"),
        ("forbidden", "ACCEPTED"),
        ("strong", "ACCEPTED"),
        ("limited", "LIMITED"),
        ("rejected", "REJECTED"),
    ] {
        let line = json
            .lines()
            .find(|l| l.contains(&format!("\"name\":\"{name}\"")))
            .unwrap();
        assert!(
            line.contains(&format!("\"verdict\":\"{verdict}\"")),
            "{name}: {line}"
        );
    }
}

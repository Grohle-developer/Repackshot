//! Integration tests: the library entry points that `rt` is built from, no subprocesses.

use rt_cli::cli::{parse_args, run, Command, Options};
use rt_core::scene::Scene;
use std::path::PathBuf;

/// A scratch file path inside Cargo's per-target temporary directory.
fn scratch(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name)
}

fn luma(rgb8: &[u8], width: usize, x: usize, y: usize) -> u32 {
    let p = &rgb8[(y * width + x) * 3..(y * width + x) * 3 + 3];
    p.iter().map(|&c| u32::from(c)).sum()
}

#[test]
fn example_scene_renders_a_bright_centre_and_a_darker_corner() {
    let (width, height) = (96usize, 72usize);
    let mut scene = rt_core::example::scene();
    let options = Options {
        samples: Some(2),
        threads: Some(2),
        size: Some((96, 72)),
        max_seconds: None,
    };
    let (samples, threads) = options.apply(&mut scene);
    let output = rt_cli::render(&scene, samples, threads);

    // At least a camera ray per pixel and sample; shadow and bounce rays on top.
    assert!(output.rays > (width * height) as u64 * u64::from(samples));
    assert_eq!(output.samples, samples);
    let rgb8 = output.to_rgb8(&scene);
    assert_eq!(rgb8.len(), width * height * 3);
    // The lit sphere fills the middle of the frame: its brightest pixel (the highlight side)
    // outshines every corner, which shows the dome or the floor and is not black either.
    let centre = (width / 3..2 * width / 3)
        .flat_map(|x| (height / 3..2 * height / 3).map(move |y| (x, y)))
        .map(|(x, y)| luma(&rgb8, width, x, y))
        .max()
        .unwrap_or(0);
    for (x, y) in [
        (0, 0),
        (width - 1, 0),
        (0, height - 1),
        (width - 1, height - 1),
    ] {
        let corner = luma(&rgb8, width, x, y);
        assert!(
            centre > corner,
            "centre {centre} should be brighter than the corner ({x}, {y}) {corner}"
        );
        assert!(corner > 30, "corner ({x}, {y}) is black: {corner}");
    }
    assert!(
        centre > 400,
        "centre {centre} is too dark to be the lit sphere"
    );
}

#[test]
fn the_cli_writes_a_valid_png_for_the_example() {
    let png_path = scratch("example.png");
    let _ = std::fs::remove_file(&png_path);
    let args: Vec<String> = [
        "--example",
        "-o",
        png_path.to_str().unwrap(),
        "--samples",
        "1",
        "--size",
        "64x48",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    run(parse_args(&args).expect("valid arguments")).expect("render succeeds");

    let png = std::fs::read(&png_path).expect("PNG written");
    assert_eq!(&png[..8], &rt_core::png::SIGNATURE);
    assert_eq!(&png[12..16], b"IHDR");
    assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 64);
    assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), 48);
    assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");
}

#[test]
fn write_example_produces_a_readable_rsb_file() {
    let path = scratch("example.rsb");
    run(Command::WriteExample { path: path.clone() }).expect("write succeeds");
    let bytes = std::fs::read(&path).expect("RSB written");
    assert_eq!(Scene::from_rsb(&bytes), Ok(rt_core::example::scene()));
}

#[test]
fn rendering_an_rsb_file_matches_rendering_the_built_in_scene() {
    let path = scratch("roundtrip.rsb");
    std::fs::write(&path, rt_core::example::scene().to_rsb()).unwrap();
    let from_file = Scene::from_rsb(&std::fs::read(&path).unwrap()).unwrap();
    let mut a = from_file;
    let mut b = rt_core::example::scene();
    for scene in [&mut a, &mut b] {
        scene.render.width = 48;
        scene.render.height = 36;
    }
    assert_eq!(rt_cli::render(&a, 1, 1).film, rt_cli::render(&b, 1, 1).film);
}

#[test]
fn the_result_does_not_depend_on_the_thread_count() {
    let mut scene = rt_core::example::scene();
    scene.render.width = 70; // not a multiple of the tile size
    scene.render.height = 50;
    let one = rt_cli::render(&scene, 2, 1);
    let many = rt_cli::render(&scene, 2, 5);
    assert_eq!(one.film, many.film);
    assert_eq!(one.rays, many.rays);
    assert!(one.rays > 70 * 50 * 2);
}

#[test]
fn progressive_passes_give_the_film_of_one_tile_at_a_time() {
    // 7 samples are rendered in passes of 1, 2 and 4 sample indices over every tile; rendering
    // each tile's seven samples in one go (as E1 and E2 did) gives the same bits.
    let mut scene = rt_core::example::scene();
    scene.render.width = 40;
    scene.render.height = 36;
    let progressive = rt_cli::render(&scene, 7, 3);
    let mut reference = rt_core::image::Film::new(40, 36);
    for tile in rt_core::render::tile_grid(40, 36, rt_cli::TILE_SIZE) {
        for sample in 0..7 {
            rt_core::render::render_tile(&scene, tile, sample, &mut reference);
        }
    }
    assert_eq!(progressive.film, reference);
    assert!(progressive.film.alpha.iter().all(|&a| a == 7.0));
}

#[test]
fn the_time_budget_stops_between_passes() {
    let mut scene = rt_core::example::scene();
    scene.render.width = 32;
    scene.render.height = 32;
    // A budget already spent after the first pass: exactly one sample everywhere.
    let out = rt_cli::render_progressive(&scene, 64, 2, Some(std::time::Duration::from_nanos(1)));
    assert_eq!(out.samples, 1);
    assert!(out.film.weight.iter().all(|&w| w == 1.0));
    // And through the CLI, from the scene's own RNDR.max_seconds.
    let path = scratch("scene-with-budget.rsb");
    scene.render.max_seconds = 1.0e-6;
    std::fs::write(&path, scene.to_rsb()).unwrap();
    let png = scratch("budget.png");
    let args: Vec<String> = [path.to_str().unwrap(), "-o", png.to_str().unwrap()]
        .iter()
        .map(|s| s.to_string())
        .collect();
    run(parse_args(&args).expect("valid")).expect("render succeeds");
    assert!(std::fs::read(&png).is_ok());
}

#[test]
fn the_sheet_writes_every_image_with_its_statistics() {
    let dir = scratch("sheet");
    let _ = std::fs::remove_dir_all(&dir);
    let entries = rt_cli::sheet::run(&dir, (40, 30), 2, 2).expect("sheet renders");
    // The six recipes, then the E5 scenes at a multiple of the samples.
    let e5 = rt_cli::scenes::e5_scenes((40, 30));
    assert_eq!(entries.len(), 6 + e5.len());
    let factors = std::iter::repeat_n(1, 6).chain(e5.iter().map(|s| s.sample_factor));
    for (e, factor) in entries.iter().zip(factors) {
        let png = std::fs::read(dir.join(&e.file)).expect("PNG written");
        assert_eq!(&png[..8], &rt_core::png::SIGNATURE);
        assert!(
            e.stats.mean_luminance > 0.02 && e.stats.mean_luminance < 0.98,
            "{e:?}"
        );
        assert_eq!(e.samples, 2 * factor, "{}", e.key);
    }
    let html = std::fs::read_to_string(dir.join("index.html")).expect("index.html");
    let json = std::fs::read_to_string(dir.join("stats.json")).expect("stats.json");
    assert!(html.contains("key-only.png") && html.contains("sun.png"));
    assert!(html.contains("e5-glass-bottle.png") && html.contains("e5-sky-dawn.png"));
    assert!(json.contains("\"recipe\": \"backlit-panel\""));
}

#[test]
fn errors_name_the_file_and_the_problem() {
    let missing = scratch("does-not-exist.rsb");
    let out = scratch("never.png");
    let command = Command::Render {
        input: rt_cli::cli::Input::File(missing.clone()),
        output: out,
        options: Options::default(),
    };
    let error = run(command).expect_err("missing file");
    assert!(error.contains("does-not-exist.rsb"), "{error}");

    let garbage = scratch("garbage.rsb");
    std::fs::write(&garbage, b"definitely not a scene").unwrap();
    let command = Command::Render {
        input: rt_cli::cli::Input::File(garbage),
        output: scratch("never.png"),
        options: Options::default(),
    };
    let error = run(command).expect_err("bad magic");
    assert!(error.contains("RSB1"), "{error}");
}

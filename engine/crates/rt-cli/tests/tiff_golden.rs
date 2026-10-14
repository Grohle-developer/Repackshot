//! The TIFF and DNG writers against the golden files in `tests/fixtures/tiff/` (the repository's
//! root), which `tests/tiff-dng.test.ts` compares the TypeScript encoders with: so the browser
//! and the engine write the same bytes. And `rt` writing them from a render.
//!
//! To change the format on purpose, rewrite the files with
//! `REPACK_WRITE_GOLDEN=1 cargo test -p rt-cli --test tiff_golden` and run both suites.

use rt_cli::cli::{parse_args, run, Options};
use rt_core::color::Tonemap;
use rt_core::tiff::{encode, Samples};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/tiff")
}

/// The 4×4 image: sample `c` of pixel `p` (`tests/tiff-dng.test.ts` builds the same ones).
fn u8_image(channels: usize) -> Vec<u8> {
    (0..16usize)
        .flat_map(|p| (0..channels).map(move |c| ((p * 17 + c * 5) & 255) as u8))
        .collect()
}

fn u16_image(channels: usize) -> Vec<u16> {
    (0..16usize)
        .flat_map(|p| (0..channels).map(move |c| ((p * 4099 + c * 1021) & 0xffff) as u16))
        .collect()
}

/// Dyadic fractions, exact in f32 (and in a JavaScript number).
fn f32_image(channels: usize) -> Vec<f32> {
    (0..16usize)
        .flat_map(|p| (0..channels).map(move |c| (p * 7 + c * 13) as f32 / 64.0))
        .collect()
}

/// 50×60 RGB bytes: 150 bytes a row, 54 rows to a strip of about 8 KiB, so two strips (54 rows and 6).
fn strips_image() -> Vec<u8> {
    (0..60usize)
        .flat_map(|y| {
            (0..50usize)
                .flat_map(move |x| (0..3usize).map(move |c| ((x * 5 + y * 3 + c * 7) & 255) as u8))
        })
        .collect()
}

fn files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        (
            "strips.tif",
            encode(50, 60, 3, Samples::U8(&strips_image()), 72),
        ),
        ("rgb8.tif", encode(4, 4, 3, Samples::U8(&u8_image(3)), 72)),
        ("rgba8.tif", encode(4, 4, 4, Samples::U8(&u8_image(4)), 72)),
        (
            "rgb16.tif",
            encode(4, 4, 3, Samples::U16(&u16_image(3)), 72),
        ),
        (
            "rgba16-300dpi.tif",
            encode(4, 4, 4, Samples::U16(&u16_image(4)), 300),
        ),
        (
            "rgb32.tif",
            encode(4, 4, 3, Samples::F32(&f32_image(3)), 72),
        ),
        (
            "rgba32.tif",
            encode(4, 4, 4, Samples::F32(&f32_image(4)), 72),
        ),
        ("linear.dng", rt_core::dng::encode(4, 4, &f32_image(3))),
    ]
}

#[test]
fn the_writers_produce_the_golden_files() {
    let dir = golden_dir();
    if std::env::var_os("REPACK_WRITE_GOLDEN").is_some() {
        std::fs::create_dir_all(&dir).unwrap();
        for (name, bytes) in files() {
            std::fs::write(dir.join(name), bytes).unwrap();
        }
    }
    for (name, bytes) in files() {
        let path = dir.join(name);
        let golden = std::fs::read(&path).unwrap_or_else(|e| {
            panic!(
                "{}: {e} (REPACK_WRITE_GOLDEN=1 writes the golden files)",
                path.display()
            )
        });
        assert_eq!(bytes, golden, "{name} differs from tests/fixtures/tiff");
    }
}

// ------------------------------------------------------------------ the command line

fn scratch(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name)
}

/// A file as the specification lays it out: the value bytes of every tag and the strips joined.
struct Read {
    tags: BTreeMap<u16, Vec<u8>>,
    pixels: Vec<u8>,
}

impl Read {
    fn shorts(&self, tag: u16) -> Vec<u16> {
        self.tags[&tag]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect()
    }

    fn longs(&self, tag: u16) -> Vec<u32> {
        self.tags[&tag]
            .chunks_exact(4)
            .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    }
}

fn read(file: &[u8]) -> Read {
    assert_eq!(&file[..4], &[b'I', b'I', 42, 0]);
    let u16_at = |at: usize| u16::from_le_bytes([file[at], file[at + 1]]);
    let u32_at = |at: usize| u32::from_le_bytes(file[at..at + 4].try_into().unwrap());
    let ifd = u32_at(4) as usize;
    let mut tags = BTreeMap::new();
    for i in 0..usize::from(u16_at(ifd)) {
        let e = ifd + 2 + 12 * i;
        let unit = match u16_at(e + 2) {
            1 | 2 => 1,
            3 => 2,
            4 => 4,
            5 | 10 => 8,
            other => panic!("field type {other}"),
        };
        let len = unit * u32_at(e + 4) as usize;
        let at = if len <= 4 {
            e + 8
        } else {
            u32_at(e + 8) as usize
        };
        tags.insert(u16_at(e), file[at..at + len].to_vec());
    }
    let mut r = Read {
        tags,
        pixels: Vec::new(),
    };
    for (offset, count) in r.longs(273).into_iter().zip(r.longs(279)) {
        r.pixels
            .extend_from_slice(&file[offset as usize..(offset + count) as usize]);
    }
    r
}

/// The example scene at 32×24, one sample: the render `rt` makes (deterministic).
fn example() -> (rt_core::scene::Scene, rt_cli::RenderOutput) {
    let mut scene = rt_core::example::scene();
    let options = Options {
        samples: Some(1),
        threads: Some(2),
        size: Some((32, 24)),
        ..Options::default()
    };
    let (samples, threads) = options.apply(&mut scene);
    let output = rt_cli::render(&scene, samples, threads);
    (scene, output)
}

fn run_rt(name: &str, extra: &[&str]) -> Vec<u8> {
    let path = scratch(name);
    let _ = std::fs::remove_file(&path);
    let mut args: Vec<String> = [
        "--example",
        "-o",
        path.to_str().unwrap(),
        "--samples",
        "1",
        "--size",
        "32x24",
        "--threads",
        "2",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(extra.iter().map(|s| s.to_string()));
    run(parse_args(&args).expect("valid arguments")).expect("render succeeds");
    std::fs::read(&path).expect("file written")
}

#[test]
fn rt_writes_8_bit_tiff_with_the_pixels_of_the_png() {
    let (scene, output) = example();
    let file = run_rt("example-8.tif", &[]);
    let t = read(&file);
    assert_eq!(t.longs(256), [32]);
    assert_eq!(t.longs(257), [24]);
    assert_eq!(t.shorts(258), [8, 8, 8]);
    assert_eq!(t.shorts(262), [2]);
    // 72 dots per inch both ways: 72/1 (the CLI has no --dpi).
    for tag in [282, 283] {
        assert_eq!(t.tags[&tag], [72, 0, 0, 0, 1, 0, 0, 0], "resolution {tag}");
    }
    assert!(!t.tags.contains_key(&339), "no SampleFormat below 32 bits");
    assert_eq!(t.pixels, output.to_rgb8(&scene));
}

#[test]
fn rt_writes_16_bit_tiff_from_the_tone_mapped_film() {
    let (scene, output) = example();
    let file = run_rt("example-16.tif", &["--bits", "16"]);
    let t = read(&file);
    assert_eq!(t.shorts(258), [16, 16, 16]);
    let words: Vec<u16> = t
        .pixels
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let want = output.film.to_srgb16_tonemapped(
        scene.render.exposure_ev,
        Tonemap::from_u32(scene.render.tonemap),
    );
    assert_eq!(words, want);
}

#[test]
fn rt_writes_32_bit_tiff_and_dng_with_the_same_linear_light() {
    let (scene, output) = example();
    let want = output.film.to_linear_exposed(scene.render.exposure_ev);
    let floats = |pixels: &[u8]| -> Vec<f32> {
        pixels
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    };

    let tiff = read(&run_rt("example-32.tif", &["--bits", "32"]));
    assert_eq!(tiff.shorts(258), [32, 32, 32]);
    assert_eq!(tiff.shorts(339), [3, 3, 3]);
    assert_eq!(floats(&tiff.pixels), want);

    let dng = read(&run_rt("example.dng", &[]));
    assert_eq!(dng.shorts(262), [34892], "LinearRaw");
    assert_eq!(dng.tags[&50706], [1, 4, 0, 0], "DNGVersion");
    assert_eq!(dng.shorts(258), [32, 32, 32]);
    assert!(!dng.tags.contains_key(&338), "no alpha in a raw");
    assert_eq!(floats(&dng.pixels), want);
    // Linear light keeps what the 8-bit file clips.
    assert!(want.iter().all(|v| v.is_finite()) && want.iter().any(|v| *v > 1.0));
}

#[test]
fn the_format_flag_beats_the_extension_and_png_stays_the_default() {
    let png = run_rt("example-default.png", &[]);
    assert_eq!(png[..8], rt_core::png::SIGNATURE);
    let forced = run_rt("example-forced.out", &["--format", "tiff"]);
    assert_eq!(&forced[..4], &[b'I', b'I', 42, 0]);
    let still_png = run_rt("example-still.tif", &["--format", "png"]);
    assert_eq!(still_png[..8], rt_core::png::SIGNATURE);
}

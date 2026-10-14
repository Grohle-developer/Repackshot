//! Command line parsing and the `rt` command itself.

use crate::{render_progressive, sheet, write_png};
use rt_core::scene::{RenderSettings, Scene, DENOISE_IMAGE, DENOISE_KEEP_NOISY};
use std::path::PathBuf;
use std::time::Duration;

/// Text printed by `rt --help` and after a usage error.
pub const USAGE: &str = "\
rt: Repackshot command line renderer

USAGE:
    rt <scene.rsb> -o <out.png> [--samples N] [--threads N] [--size WxH] [--max-seconds S]
       [--denoise] [--keep-noisy] [--caustics N] [--caustic-radius R]
    rt --example -o <out.png> [--samples N] [--threads N] [--size WxH] [--max-seconds S]
    rt --sheet <dir> [--samples N] [--threads N] [--size WxH]
    rt --write-example <scene.rsb>
    rt --write-e5-example <scene.rsb>
    rt --write-e5c-example <scene.rsb>
    rt --write-e5b-example <scene.rsb>
    rt --write-e9-example <scene.rsb>
    rt --sss-sheet <dir> [--samples N] [--threads N] [--size WxH]
    rt --write-studio-hdri <studio.hdr>
    rt --tone-table

OPTIONS:
    -o, --output <file>     PNG file to write
        --samples <N>       samples per pixel (default: the scene's, else 16; sheet: 64)
        --threads <N>       worker threads (default: all cores)
        --size <WxH>        image size in pixels, overriding the scene (sheet: 480x360)
        --max-seconds <S>   time budget, overriding the scene's RNDR.max_seconds; rendering
                            stops between sample passes once it is spent (0: no limit)
        --denoise           write the denoised image (RNDR.denoise bit 0), guided by the
                            albedo, normal, depth and id passes rendered with it
        --keep-noisy        with --denoise, also write the image without denoise next to it
                            (<out>-noisy.png)
        --caustics <N>      trace N caustic photons per sample (RNDR.caustic_photons; 0: off)
        --caustic-radius <R>
                            first gather radius of the caustics in pixels (default 3)
        --example           render the built-in example scene instead of a file
        --sheet <dir>       render the example part under six built-in light recipes, the
                            E5 scenes (glass, coat, emitter, sky, HDRI) and the E5c skies
                            (physical against classic) into <dir>: one PNG each, index.html
                            and stats.json
        --write-example <f> write the built-in example scene as an RSB file
        --write-e5-example <f>
                            write the E5 parity scene (glass, cut-outs, anisotropy, HDRI,
                            background image) as an RSB file
        --write-e5c-example <f>
                            write the E5c parity scene (the E5 scene under the physical sky,
                            low sun) as an RSB file
        --write-e5b-example <f>
                            write the E5b-1 parity scene (the E5 scene with caustic photons)
                            as an RSB file
        --write-e9-example <f>
                            write the E9 parity scene (the E5 scene with a scattering
                            medium in its big sphere) as an RSB file
        --sss-sheet <dir>   render the E9 contact sheet of the scattering media (each
                            recipe as a sphere, the perfume bottle filled with milk and
                            juice, with and without the medium, the milk bottle with
                            caustic photons, at N and 4 N samples, default 64) into
                            <dir>: sss-sheet.html and sss/*.png
        --write-studio-hdri <f>
                            write the procedural studio HDRI (Radiance .hdr) of the sheet
        --tone-table        print reference values of the tone curves as JSON (for the
                            interface's tests)
    -h, --help              show this help
";

/// Where the scene comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Input {
    /// An RSB file on disk.
    File(PathBuf),
    /// The built-in example scene.
    Example,
}

/// Overrides of the scene's render settings.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Options {
    /// Samples per pixel.
    pub samples: Option<u32>,
    /// Number of worker threads.
    pub threads: Option<usize>,
    /// Image size `(width, height)`.
    pub size: Option<(u32, u32)>,
    /// Time budget in seconds (0: none), overriding the scene's.
    pub max_seconds: Option<f32>,
    /// `--denoise`: hand out the denoised image.
    pub denoise: bool,
    /// `--keep-noisy`: also the image without denoise.
    pub keep_noisy: bool,
    /// Caustic photons per sample, overriding the scene's.
    pub caustics: Option<u32>,
    /// First caustic gather radius in pixels, overriding the scene's.
    pub caustic_radius: Option<f32>,
}

impl Options {
    /// Applies the size override to `scene` and returns the effective `(samples, threads)`.
    pub fn apply(&self, scene: &mut Scene) -> (u32, usize) {
        if let Some((width, height)) = self.size {
            scene.render.width = width;
            scene.render.height = height;
        }
        if self.denoise {
            scene.render.denoise |= DENOISE_IMAGE;
        }
        if self.keep_noisy {
            scene.render.denoise |= DENOISE_KEEP_NOISY;
        }
        if let Some(photons) = self.caustics {
            scene.render.caustic_photons = photons;
        }
        if let Some(radius) = self.caustic_radius {
            scene.render.caustic_radius = radius;
        }
        let samples = self.samples.unwrap_or(if scene.render.max_samples > 0 {
            scene.render.max_samples
        } else {
            16
        });
        let threads = self
            .threads
            .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
        (samples, threads)
    }

    /// The time budget: `--max-seconds`, else the scene's `max_seconds`; `None` for no limit
    /// (zero, or more seconds than a `Duration` holds).
    pub fn budget(&self, scene: &Scene) -> Option<Duration> {
        let seconds = self.max_seconds.unwrap_or(scene.render.max_seconds);
        if seconds > 0.0 {
            Duration::try_from_secs_f32(seconds).ok()
        } else {
            None
        }
    }
}

/// A parsed command line.
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    /// Render a scene to a PNG.
    Render {
        /// Scene source.
        input: Input,
        /// PNG to write.
        output: PathBuf,
        /// Overrides.
        options: Options,
    },
    /// Render the contact sheet into a directory.
    Sheet {
        /// Output directory.
        dir: PathBuf,
        /// Overrides (samples, threads, size).
        options: Options,
    },
    /// Write the example scene as an RSB file.
    WriteExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the E5 parity scene (`rt_core::example::e5_scene`) as an RSB file.
    WriteE5Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the E5c parity scene (`rt_core::example::e5c_scene`) as an RSB file.
    WriteE5cExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the E5b-1 parity scene (`rt_core::example::e5b_scene`) as an RSB file.
    WriteE5bExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the E9 parity scene (`rt_core::example::e9_scene`) as an RSB file.
    WriteE9Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Render the E9 contact sheet of the scattering media into a directory.
    SssSheet {
        /// Output directory.
        dir: PathBuf,
        /// Samples, threads and size overrides.
        options: Options,
    },
    /// Write the procedural studio HDRI as a Radiance `.hdr` file.
    WriteStudioHdri {
        /// `.hdr` file to write.
        path: PathBuf,
    },
    /// Print the reference values of the tone curves (`tone::table_json`).
    ToneTable,
    /// Print the usage text.
    Help,
}

fn value<'a>(
    args: &mut impl Iterator<Item = &'a String>,
    flag: &str,
) -> Result<&'a String, String> {
    args.next().ok_or_else(|| format!("{flag} needs a value"))
}

fn positive(text: &str, flag: &str) -> Result<u32, String> {
    match text.parse::<u32>() {
        Ok(n) if n > 0 => Ok(n),
        _ => Err(format!("{flag} expects a positive integer, got '{text}'")),
    }
}

fn seconds(text: &str, flag: &str) -> Result<f32, String> {
    match text.parse::<f32>() {
        Ok(s) if s >= 0.0 && s.is_finite() => Ok(s),
        _ => Err(format!(
            "{flag} expects a non-negative number of seconds, got '{text}'"
        )),
    }
}

fn parse_size(text: &str) -> Result<(u32, u32), String> {
    let bad = || format!("--size expects WxH such as 1280x720, got '{text}'");
    let (w, h) = text.split_once(['x', 'X']).ok_or_else(bad)?;
    let (w, h) = (
        w.parse::<u32>().map_err(|_| bad())?,
        h.parse::<u32>().map_err(|_| bad())?,
    );
    let range = 1..=RenderSettings::MAX_DIMENSION;
    if range.contains(&w) && range.contains(&h) {
        Ok((w, h))
    } else {
        Err(format!(
            "--size must be between 1x1 and {0}x{0}",
            RenderSettings::MAX_DIMENSION
        ))
    }
}

/// Parses the arguments that follow the program name.
pub fn parse_args(args: &[String]) -> Result<Command, String> {
    let mut input = None;
    let mut output = None;
    let mut write_example = None;
    let mut write_hdri = None;
    let mut write_e5 = None;
    let mut write_e5c = None;
    let mut write_e5b = None;
    let mut write_e9 = None;
    let mut sss_dir = None;
    let mut sheet_dir = None;
    let mut tone_table = false;
    let mut options = Options::default();
    let mut it = args.iter();

    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "-o" | "--output" => output = Some(PathBuf::from(value(&mut it, arg)?)),
            "--samples" => options.samples = Some(positive(value(&mut it, arg)?, arg)?),
            "--threads" => options.threads = Some(positive(value(&mut it, arg)?, arg)? as usize),
            "--size" => options.size = Some(parse_size(value(&mut it, arg)?)?),
            "--max-seconds" => options.max_seconds = Some(seconds(value(&mut it, arg)?, arg)?),
            "--denoise" => options.denoise = true,
            "--keep-noisy" => options.keep_noisy = true,
            "--caustics" => {
                let text = value(&mut it, arg)?;
                match text.parse::<u32>() {
                    Ok(n) if n <= RenderSettings::MAX_CAUSTIC_PHOTONS => options.caustics = Some(n),
                    _ => {
                        return Err(format!(
                            "--caustics expects a number of photons up to {}, got '{text}'",
                            RenderSettings::MAX_CAUSTIC_PHOTONS
                        ))
                    }
                }
            }
            "--caustic-radius" => {
                options.caustic_radius = Some(seconds(value(&mut it, arg)?, arg).map_err(|_| {
                    "--caustic-radius expects a non-negative number of pixels".to_string()
                })?)
            }
            "--sheet" => sheet_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--sss-sheet" => sss_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--example" => {
                if input.replace(Input::Example).is_some() {
                    return Err("only one scene can be rendered at a time".into());
                }
            }
            "--write-example" => write_example = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-studio-hdri" => write_hdri = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-e5-example" => write_e5 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-e5c-example" => write_e5c = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-e5b-example" => write_e5b = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-e9-example" => write_e9 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--tone-table" => tone_table = true,
            flag if flag.starts_with('-') && flag.len() > 1 => {
                return Err(format!("unknown option '{flag}'"));
            }
            file => {
                if input.replace(Input::File(PathBuf::from(file))).is_some() {
                    return Err("only one scene can be rendered at a time".into());
                }
            }
        }
    }

    if tone_table {
        if args.len() != 1 {
            return Err("--tone-table takes no other option".into());
        }
        return Ok(Command::ToneTable);
    }
    if let Some(path) = write_e5 {
        if args.len() != 2 {
            return Err("--write-e5-example takes no other option".into());
        }
        return Ok(Command::WriteE5Example { path });
    }
    if let Some(path) = write_e5c {
        if args.len() != 2 {
            return Err("--write-e5c-example takes no other option".into());
        }
        return Ok(Command::WriteE5cExample { path });
    }
    if let Some(path) = write_e5b {
        if args.len() != 2 {
            return Err("--write-e5b-example takes no other option".into());
        }
        return Ok(Command::WriteE5bExample { path });
    }
    if let Some(path) = write_e9 {
        if args.len() != 2 {
            return Err("--write-e9-example takes no other option".into());
        }
        return Ok(Command::WriteE9Example { path });
    }
    if let Some(dir) = sss_dir {
        if input.is_some() || output.is_some() {
            return Err("--sss-sheet renders its own scenes".into());
        }
        return Ok(Command::SssSheet { dir, options });
    }
    if let Some(path) = write_hdri {
        if args.len() != 2 {
            return Err("--write-studio-hdri takes no other option".into());
        }
        return Ok(Command::WriteStudioHdri { path });
    }
    if let Some(path) = write_example {
        if input.is_some() || output.is_some() || options != Options::default() {
            return Err("--write-example cannot be combined with rendering options".into());
        }
        return Ok(Command::WriteExample { path });
    }
    if let Some(dir) = sheet_dir {
        if input.is_some() || output.is_some() || options.max_seconds.is_some() {
            return Err("--sheet renders its own scenes: no scene, -o or --max-seconds".into());
        }
        return Ok(Command::Sheet { dir, options });
    }
    let input = input.ok_or("no scene given: pass a .rsb file or --example")?;
    let output = output.ok_or("no output given: pass -o <out.png>")?;
    Ok(Command::Render {
        input,
        output,
        options,
    })
}

/// `<out>-noisy.<ext>`: where `--keep-noisy` writes the image without denoise.
pub fn noisy_path(output: &std::path::Path) -> PathBuf {
    let stem = output
        .file_stem()
        .map_or_else(|| "out".into(), |s| s.to_string_lossy().into_owned());
    let name = match output.extension() {
        Some(ext) => format!("{stem}-noisy.{}", ext.to_string_lossy()),
        None => format!("{stem}-noisy"),
    };
    output.with_file_name(name)
}

/// Runs a parsed command, printing progress to standard output.
pub fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Help => {
            print!("{USAGE}");
            Ok(())
        }
        Command::ToneTable => {
            print!("{}", crate::tone::table_json());
            Ok(())
        }
        Command::WriteExample { path } => {
            let bytes = rt_core::example::scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteE5Example { path } => {
            let bytes = rt_core::example::e5_scene(false).to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteE5cExample { path } => {
            let bytes = rt_core::example::e5c_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteE5bExample { path } => {
            let bytes = rt_core::example::e5b_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteE9Example { path } => {
            let bytes = rt_core::example::e9_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::SssSheet { dir, options } => {
            let size = options.size.unwrap_or(crate::sss_sheet::SIZE);
            let samples = options.samples.unwrap_or(crate::sss_sheet::SAMPLES);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            let entries = crate::sss_sheet::run(&dir, size, samples, threads)?;
            for e in &entries {
                println!(
                    "{:<36} {:>5} spp {:>8.1} s  mean {:.3}",
                    e.key, e.samples, e.seconds, e.mean
                );
            }
            println!("wrote {}", dir.join("sss-sheet.html").display());
            Ok(())
        }
        Command::WriteStudioHdri { path } => {
            let bytes = crate::scenes::studio_hdri_file();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::Sheet { dir, options } => {
            let size = options.size.unwrap_or(sheet::SHEET_SIZE);
            let samples = options.samples.unwrap_or(sheet::SHEET_SAMPLES);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            println!(
                "sheet: {} recipes, {}x{}, {samples} spp, {threads} threads",
                sheet::recipes().len(),
                size.0,
                size.1
            );
            for e in sheet::run(&dir, size, samples, threads)? {
                println!(
                    "  {:<14} mean {:.3}  clipped {:5.2} %  crushed {:5.2} %  {:.1} s",
                    e.key,
                    e.stats.mean_luminance,
                    100.0 * e.stats.clipped_white,
                    100.0 * e.stats.crushed_black,
                    e.seconds
                );
            }
            println!("wrote {}", dir.join("index.html").display());
            Ok(())
        }
        Command::Render {
            input,
            output,
            options,
        } => {
            let mut scene = match &input {
                Input::Example => rt_core::example::scene(),
                Input::File(path) => {
                    let bytes =
                        std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
                    Scene::from_rsb(&bytes).map_err(|e| format!("{}: {e}", path.display()))?
                }
            };
            let (samples, threads) = options.apply(&mut scene);
            let budget = options.budget(&scene);
            let (width, height) = (scene.render.width, scene.render.height);
            println!(
                "scene: {} triangles in {} meshes, {} instances, {} lights; image {width}x{height}, \
                 {samples} spp, {threads} threads; simd {}, BVH{}",
                scene.triangle_count(),
                scene.geometry.meshes().len(),
                scene.geometry.instances().len(),
                scene.lights.len(),
                rt_core::simd::Isa::detect().name(),
                scene.geometry.bvh_stats().width.lanes()
            );

            let result = render_progressive(&scene, samples, threads, budget);
            println!(
                "rendered {} spp, {} rays in {:.3} s ({:.2} Mrays/s)",
                result.samples,
                result.rays,
                result.elapsed.as_secs_f64(),
                result.rays_per_second() / 1.0e6
            );

            let tone = |film: &rt_core::image::Film| {
                film.to_srgb8_tonemapped(
                    scene.render.exposure_ev,
                    rt_core::color::Tonemap::from_u32(scene.render.tonemap),
                )
            };
            if scene.render.denoise & DENOISE_IMAGE != 0 {
                let t0 = std::time::Instant::now();
                let clean = result
                    .denoised(threads)
                    .ok_or("the denoiser found no guide passes")?;
                println!("denoised in {:.3} s", t0.elapsed().as_secs_f64());
                write_png(&output, width, height, &tone(&clean))
                    .map_err(|e| format!("{}: {e}", output.display()))?;
                println!("wrote {}", output.display());
                if scene.render.denoise & DENOISE_KEEP_NOISY != 0 {
                    let noisy = noisy_path(&output);
                    write_png(&noisy, width, height, &result.to_rgb8(&scene))
                        .map_err(|e| format!("{}: {e}", noisy.display()))?;
                    println!("wrote {}", noisy.display());
                }
            } else {
                write_png(&output, width, height, &result.to_rgb8(&scene))
                    .map_err(|e| format!("{}: {e}", output.display()))?;
                println!("wrote {}", output.display());
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Command, String> {
        parse_args(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_a_full_render_command() {
        assert_eq!(
            parse(&[
                "scene.rsb",
                "-o",
                "out.png",
                "--samples",
                "8",
                "--threads",
                "2",
                "--size",
                "320x200"
            ]),
            Ok(Command::Render {
                input: Input::File("scene.rsb".into()),
                output: "out.png".into(),
                options: Options {
                    samples: Some(8),
                    threads: Some(2),
                    size: Some((320, 200)),
                    max_seconds: None,
                    ..Options::default()
                },
            })
        );
        assert_eq!(
            parse(&["--example", "--output", "x.png", "--size", "64X48"]),
            Ok(Command::Render {
                input: Input::Example,
                output: "x.png".into(),
                options: Options {
                    size: Some((64, 48)),
                    ..Options::default()
                },
            })
        );
    }

    #[test]
    fn parses_the_sheet_and_the_time_budget() {
        assert_eq!(
            parse(&["--sheet", "out/sheet", "--samples", "4"]),
            Ok(Command::Sheet {
                dir: "out/sheet".into(),
                options: Options {
                    samples: Some(4),
                    ..Options::default()
                },
            })
        );
        let Ok(Command::Render { options, .. }) =
            parse(&["--example", "-o", "x.png", "--max-seconds", "2.5"])
        else {
            panic!("render command expected");
        };
        assert_eq!(options.max_seconds, Some(2.5));
        let mut scene = rt_core::example::scene();
        assert_eq!(options.budget(&scene), Some(Duration::from_secs_f32(2.5)));
        assert_eq!(Options::default().budget(&scene), None);
        scene.render.max_seconds = 3.0;
        assert_eq!(
            Options::default().budget(&scene),
            Some(Duration::from_secs(3))
        );
        let zero = Options {
            max_seconds: Some(0.0),
            ..Options::default()
        };
        assert_eq!(
            zero.budget(&scene),
            None,
            "an explicit 0 lifts the scene's limit"
        );
        scene.render.max_seconds = 1.0e30; // finite, valid RSB, beyond any Duration
        assert_eq!(Options::default().budget(&scene), None);
    }

    #[test]
    fn parses_write_example_and_help() {
        assert_eq!(
            parse(&["--write-example", "s.rsb"]),
            Ok(Command::WriteExample {
                path: "s.rsb".into()
            })
        );
        assert_eq!(
            parse(&["--write-e5-example", "e5.rsb"]),
            Ok(Command::WriteE5Example {
                path: "e5.rsb".into()
            })
        );
        assert_eq!(
            parse(&["--write-studio-hdri", "s.hdr"]),
            Ok(Command::WriteStudioHdri {
                path: "s.hdr".into()
            })
        );
        assert!(parse(&["--write-studio-hdri", "s.hdr", "--samples", "4"]).is_err());
        assert!(parse(&["--write-e5-example", "e5.rsb", "--example"]).is_err());
        assert_eq!(
            parse(&["--write-e5c-example", "e5c.rsb"]),
            Ok(Command::WriteE5cExample {
                path: "e5c.rsb".into()
            })
        );
        assert!(parse(&["--write-e5c-example", "e5c.rsb", "--samples", "2"]).is_err());
        assert_eq!(parse(&["--tone-table"]), Ok(Command::ToneTable));
        assert!(parse(&["--tone-table", "--example"]).is_err());
        assert_eq!(parse(&["--help"]), Ok(Command::Help));
        assert_eq!(parse(&["-h"]), Ok(Command::Help));
    }

    #[test]
    fn reports_usage_errors() {
        for bad in [
            &[][..],
            &["scene.rsb"],
            &["-o", "out.png"],
            &["scene.rsb", "other.rsb", "-o", "o.png"],
            &["--example", "scene.rsb", "-o", "o.png"],
            &["scene.rsb", "-o"],
            &["scene.rsb", "-o", "o.png", "--samples", "0"],
            &["scene.rsb", "-o", "o.png", "--threads", "many"],
            &["scene.rsb", "-o", "o.png", "--size", "100"],
            &["scene.rsb", "-o", "o.png", "--size", "0x10"],
            &["scene.rsb", "-o", "o.png", "--size", "99999x10"],
            &["scene.rsb", "-o", "o.png", "--bogus"],
            &["--write-example", "s.rsb", "-o", "o.png"],
            &["--write-example"],
            &["--sheet"],
            &["--sheet", "d", "--example"],
            &["--sheet", "d", "-o", "o.png"],
            &["--example", "-o", "o.png", "--max-seconds", "-1"],
            &["--example", "-o", "o.png", "--max-seconds", "soon"],
        ] {
            assert!(parse(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn options_apply_size_and_defaults() {
        let mut scene = rt_core::example::scene();
        let (samples, threads) = Options::default().apply(&mut scene);
        assert_eq!(samples, scene.render.max_samples);
        assert!(threads >= 1);
        let (samples, threads) = Options {
            samples: Some(3),
            threads: Some(5),
            size: Some((10, 20)),
            max_seconds: None,
            denoise: true,
            keep_noisy: true,
            caustics: Some(4096),
            caustic_radius: Some(2.0),
        }
        .apply(&mut scene);
        assert_eq!((samples, threads), (3, 5));
        assert_eq!((scene.render.width, scene.render.height), (10, 20));
        assert_eq!(scene.render.denoise, DENOISE_IMAGE | DENOISE_KEEP_NOISY);
        assert_eq!(
            (scene.render.caustic_photons, scene.render.caustic_radius),
            (4096, 2.0)
        );
        scene.render.max_samples = 0;
        assert_eq!(Options::default().apply(&mut scene).0, 16);
    }
}

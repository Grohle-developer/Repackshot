//! Command line parsing and the `rt` command itself.

use crate::{encode_film, render_progressive, sheet, write_file, OutputFormat, OutputSpec};
use rt_core::color::Tonemap;
use rt_core::scene::{RenderSettings, Scene, DENOISE_IMAGE, DENOISE_KEEP_NOISY};
use std::path::PathBuf;
use std::time::Duration;

/// Text printed by `rt --help` and after a usage error.
pub const USAGE: &str = "\
rt: Repackshot command line renderer

USAGE:
    rt <scene.rsb> -o <out.png> [--samples N] [--threads N] [--size WxH] [--max-seconds S]
       [--denoise] [--keep-noisy] [--caustics N] [--caustic-radius R] [--format F] [--bits N]
    rt --example -o <out.png> [--samples N] [--threads N] [--size WxH] [--max-seconds S]
    rt --sheet <dir> [--samples N] [--threads N] [--size WxH]
    rt --filter-sheet <dir> [--samples N] [--threads N] [--size WxH] [--only keys]
    rt --write-example <scene.rsb>
    rt --write-e5-example <scene.rsb>
    rt --write-e5c-example <scene.rsb>
    rt --write-e5b-example <scene.rsb>
    rt --write-o1-example <scene.rsb>
    rt --write-o3a-example <scene.rsb>
    rt --write-studio-hdri <studio.hdr>
    rt --tone-table

OPTIONS:
    -o, --output <file>     image file to write (PNG, or TIFF or DNG with --format or by extension)
        --format <F>        png (the default), tiff or dng; without it, the output's extension
                            decides: .tif and .tiff are TIFF, .dng is DNG, anything else PNG
        --bits <N>          bits per channel: PNG 8; TIFF 8 (default), 16 (sRGB) or 32 (float,
                            linear light, exposure applied, no tone curve); DNG 32. A DNG is a
                            linear raw a photo developer opens with the whole latitude of the
                            render
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
        --filter-sheet <dir>
                            render the perfume bottle through every effect filter of the lens
                            at three grades, two stacks and none (512x384, 128 spp) into <dir>:
                            one PNG each and index.json (tools/lens-filters-sheet.mjs)
        --only <keys>       with --filter-sheet: only those cells (comma separated), the others
                            kept in index.json
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
        --write-o1-example <f>
                            write the O1 parity scene (the example through a lens with every
                            knob of the enhanced thin lens, and bokeh lights) as an RSB file
        --write-o3a-example <f>
                            write the O3a parity scene (the example through a stack of three
                            effect filters on the lens, and bokeh lights) as an RSB file
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
    /// `--format`: the file format (else the output's extension decides).
    pub format: Option<OutputFormat>,
    /// `--bits`: bits per channel.
    pub bits: Option<u32>,
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
    /// Render the sheet of the effect filters (O3a) into a directory.
    FilterSheet {
        /// Output directory.
        dir: PathBuf,
        /// Overrides (samples, threads, size).
        options: Options,
        /// Only these cells (`--only key,key`), the others kept from `index.json`.
        only: Vec<String>,
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
    /// Write the O1 parity scene (`rt_core::example::o1_scene`) as an RSB file.
    WriteO1Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the O3a parity scene (`rt_core::example::o3a_scene`) as an RSB file.
    WriteO3aExample {
        /// RSB file to write.
        path: PathBuf,
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

fn parse_format(text: &str) -> Result<OutputFormat, String> {
    match text.to_ascii_lowercase().as_str() {
        "png" => Ok(OutputFormat::Png),
        "tiff" | "tif" => Ok(OutputFormat::Tiff),
        "dng" => Ok(OutputFormat::Dng),
        _ => Err(format!("--format expects png, tiff or dng, got '{text}'")),
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
    let mut write_o1 = None;
    let mut write_o3a = None;
    let mut sheet_dir = None;
    let mut filter_sheet_dir = None;
    let mut only: Vec<String> = Vec::new();
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
            "--format" => options.format = Some(parse_format(value(&mut it, arg)?)?),
            "--bits" => {
                let text = value(&mut it, arg)?;
                match text.parse::<u32>() {
                    Ok(n @ (8 | 16 | 32)) => options.bits = Some(n),
                    _ => return Err(format!("--bits expects 8, 16 or 32, got '{text}'")),
                }
            }
            "--sheet" => sheet_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--filter-sheet" => filter_sheet_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--only" => {
                only = value(&mut it, arg)?
                    .split(',')
                    .map(str::to_string)
                    .collect()
            }
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
            "--write-o1-example" => write_o1 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-o3a-example" => write_o3a = Some(PathBuf::from(value(&mut it, arg)?)),
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
    if let Some(path) = write_o1 {
        if args.len() != 2 {
            return Err("--write-o1-example takes no other option".into());
        }
        return Ok(Command::WriteO1Example { path });
    }
    if let Some(path) = write_o3a {
        if args.len() != 2 {
            return Err("--write-o3a-example takes no other option".into());
        }
        return Ok(Command::WriteO3aExample { path });
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
        if input.is_some()
            || output.is_some()
            || options.max_seconds.is_some()
            || options.format.is_some()
            || options.bits.is_some()
        {
            return Err(
                "--sheet renders its own scenes: no scene, -o, --max-seconds, --format or --bits"
                    .into(),
            );
        }
        return Ok(Command::Sheet { dir, options });
    }
    if let Some(dir) = filter_sheet_dir {
        if input.is_some() || output.is_some() || options.max_seconds.is_some() {
            return Err(
                "--filter-sheet renders its own scenes: no scene, -o or --max-seconds".into(),
            );
        }
        return Ok(Command::FilterSheet { dir, options, only });
    }
    if !only.is_empty() {
        return Err("--only goes with --filter-sheet".into());
    }
    let input = input.ok_or("no scene given: pass a .rsb file or --example")?;
    let output = output.ok_or("no output given: pass -o <out.png>")?;
    // Refused here, with the usage, not after the render.
    OutputSpec::resolve(options.format, options.bits, &output)?;
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
        Command::WriteO1Example { path } => {
            let bytes = rt_core::example::o1_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteO3aExample { path } => {
            let bytes = rt_core::example::o3a_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
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
        Command::FilterSheet { dir, options, only } => {
            let size = options
                .size
                .unwrap_or(crate::filter_sheet::FILTER_SHEET_SIZE);
            let samples = options
                .samples
                .unwrap_or(crate::filter_sheet::FILTER_SHEET_SAMPLES);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            println!(
                "filter sheet: {}x{}, {samples} spp, {threads} threads",
                size.0, size.1
            );
            let n = crate::filter_sheet::run(&dir, size, samples, threads, &only)?;
            println!("wrote {n} images and {}", dir.join("index.json").display());
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

            let spec = OutputSpec::resolve(options.format, options.bits, &output)?;
            let (exposure_ev, tonemap) = (
                scene.render.exposure_ev,
                Tonemap::from_u32(scene.render.tonemap),
            );
            let write = |path: &std::path::Path, film: &rt_core::image::Film| {
                write_file(path, &encode_film(film, exposure_ev, tonemap, spec))
                    .map_err(|e| format!("{}: {e}", path.display()))
            };
            if scene.render.denoise & DENOISE_IMAGE != 0 {
                let t0 = std::time::Instant::now();
                let clean = result
                    .denoised(threads)
                    .ok_or("the denoiser found no guide passes")?;
                println!("denoised in {:.3} s", t0.elapsed().as_secs_f64());
                write(&output, &clean)?;
                println!("wrote {}", output.display());
                if scene.render.denoise & DENOISE_KEEP_NOISY != 0 {
                    let noisy = noisy_path(&output);
                    write(&noisy, &result.film)?;
                    println!("wrote {}", noisy.display());
                }
            } else {
                write(&output, &result.film)?;
                println!("wrote {}", output.display());
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{OutputFormat, OutputSpec};

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
    fn the_output_format_comes_from_the_flags_or_the_extension() {
        let spec = |args: &[&str]| {
            let Ok(Command::Render {
                output, options, ..
            }) = parse(args)
            else {
                panic!("{args:?} should parse");
            };
            OutputSpec::resolve(options.format, options.bits, &output).unwrap()
        };
        let tiff = |bits| OutputSpec {
            format: OutputFormat::Tiff,
            bits,
        };
        assert_eq!(
            spec(&["--example", "-o", "a.png"]),
            OutputSpec {
                format: OutputFormat::Png,
                bits: 8
            }
        );
        assert_eq!(spec(&["--example", "-o", "a.tif"]), tiff(8));
        assert_eq!(
            spec(&["--example", "-o", "a.TIFF", "--bits", "16"]),
            tiff(16)
        );
        assert_eq!(
            spec(&[
                "--example",
                "-o",
                "a.out",
                "--format",
                "tiff",
                "--bits",
                "32"
            ]),
            tiff(32)
        );
        let dng = OutputSpec {
            format: OutputFormat::Dng,
            bits: 32,
        };
        assert_eq!(spec(&["--example", "-o", "a.dng"]), dng);
        assert_eq!(spec(&["--example", "-o", "a.raw", "--format", "dng"]), dng);
        assert_eq!(spec(&["--example", "-o", "a.dng", "--bits", "32"]), dng);
        // The flag wins over the extension.
        assert_eq!(
            spec(&["--example", "-o", "a.tif", "--format", "png"]).format,
            OutputFormat::Png
        );
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
        assert_eq!(
            parse(&["--write-o1-example", "o1.rsb"]),
            Ok(Command::WriteO1Example {
                path: "o1.rsb".into()
            })
        );
        assert!(parse(&["--write-o1-example", "o1.rsb", "--example"]).is_err());
        assert_eq!(
            parse(&["--write-o3a-example", "o3a.rsb"]),
            Ok(Command::WriteO3aExample {
                path: "o3a.rsb".into()
            })
        );
        assert!(parse(&["--write-o3a-example", "o3a.rsb", "--samples", "2"]).is_err());
        assert_eq!(
            parse(&["--filter-sheet", "out", "--only", "star--1,none"]),
            Ok(Command::FilterSheet {
                dir: "out".into(),
                options: Options::default(),
                only: vec!["star--1".into(), "none".into()],
            })
        );
        assert!(parse(&["--example", "-o", "a.png", "--only", "none"]).is_err());
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
            &["--example", "-o", "o.png", "--format", "jpeg"],
            &["--example", "-o", "o.png", "--format"],
            &["--example", "-o", "o.tif", "--bits", "12"],
            &["--example", "-o", "o.tif", "--bits", "many"],
            // A PNG is 8-bit and a DNG is 32-bit float: the mismatch is refused before rendering.
            &["--example", "-o", "o.png", "--bits", "16"],
            &["--example", "-o", "o.dng", "--bits", "8"],
            &[
                "--example",
                "-o",
                "o.tif",
                "--format",
                "dng",
                "--bits",
                "16",
            ],
            &["--sheet", "d", "--format", "tiff"],
            &["--sheet", "d", "--bits", "16"],
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
            ..Options::default()
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

//! Command line parsing and the `rt` command itself.

use crate::{render, write_png};
use rt_core::scene::{RenderSettings, Scene};
use std::path::PathBuf;

/// Text printed by `rt --help` and after a usage error.
pub const USAGE: &str = "\
rt: Repackshot command line renderer

USAGE:
    rt <scene.rsb> -o <out.png> [--samples N] [--threads N] [--size WxH]
    rt --example -o <out.png> [--samples N] [--threads N] [--size WxH]
    rt --write-example <scene.rsb>

OPTIONS:
    -o, --output <file>     PNG file to write
        --samples <N>       samples per pixel (default: the scene's, else 16)
        --threads <N>       worker threads (default: all cores)
        --size <WxH>        image size in pixels, overriding the scene
        --example           render the built-in example scene instead of a file
        --write-example <f> write the built-in example scene as an RSB file
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
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Options {
    /// Samples per pixel.
    pub samples: Option<u32>,
    /// Number of worker threads.
    pub threads: Option<usize>,
    /// Image size `(width, height)`.
    pub size: Option<(u32, u32)>,
}

impl Options {
    /// Applies the size override to `scene` and returns the effective `(samples, threads)`.
    pub fn apply(&self, scene: &mut Scene) -> (u32, usize) {
        if let Some((width, height)) = self.size {
            scene.render.width = width;
            scene.render.height = height;
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
}

/// A parsed command line.
#[derive(Clone, Debug, PartialEq, Eq)]
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
    /// Write the example scene as an RSB file.
    WriteExample {
        /// RSB file to write.
        path: PathBuf,
    },
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
    let mut options = Options::default();
    let mut it = args.iter();

    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "-o" | "--output" => output = Some(PathBuf::from(value(&mut it, arg)?)),
            "--samples" => options.samples = Some(positive(value(&mut it, arg)?, arg)?),
            "--threads" => options.threads = Some(positive(value(&mut it, arg)?, arg)? as usize),
            "--size" => options.size = Some(parse_size(value(&mut it, arg)?)?),
            "--example" => {
                if input.replace(Input::Example).is_some() {
                    return Err("only one scene can be rendered at a time".into());
                }
            }
            "--write-example" => write_example = Some(PathBuf::from(value(&mut it, arg)?)),
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

    if let Some(path) = write_example {
        if input.is_some() || output.is_some() || options != Options::default() {
            return Err("--write-example cannot be combined with rendering options".into());
        }
        return Ok(Command::WriteExample { path });
    }
    let input = input.ok_or("no scene given: pass a .rsb file or --example")?;
    let output = output.ok_or("no output given: pass -o <out.png>")?;
    Ok(Command::Render {
        input,
        output,
        options,
    })
}

/// Runs a parsed command, printing progress to standard output.
pub fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Help => {
            print!("{USAGE}");
            Ok(())
        }
        Command::WriteExample { path } => {
            let bytes = rt_core::example::scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
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

            let result = render(&scene, samples, threads);
            println!(
                "rendered {} rays in {:.3} s ({:.2} Mrays/s)",
                result.rays,
                result.elapsed.as_secs_f64(),
                result.rays_per_second() / 1.0e6
            );

            write_png(&output, width, height, &result.to_rgb8(&scene))
                .map_err(|e| format!("{}: {e}", output.display()))?;
            println!("wrote {}", output.display());
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
                    size: Some((320, 200))
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
    fn parses_write_example_and_help() {
        assert_eq!(
            parse(&["--write-example", "s.rsb"]),
            Ok(Command::WriteExample {
                path: "s.rsb".into()
            })
        );
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
        }
        .apply(&mut scene);
        assert_eq!((samples, threads), (3, 5));
        assert_eq!((scene.render.width, scene.render.height), (10, 20));
        scene.render.max_samples = 0;
        assert_eq!(Options::default().apply(&mut scene).0, 16);
    }
}

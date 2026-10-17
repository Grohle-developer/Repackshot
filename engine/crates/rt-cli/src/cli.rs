//! Command line parsing and the `rt` command itself.

use crate::{encode_film, render_progressive, sheet, write_file, OutputFormat, OutputSpec};
use rt_core::color::Tonemap;
use rt_core::pixel_filter::{
    FILTER_BLACKMAN_HARRIS, FILTER_NONE, FILTER_STANDARD, FILTER_TENT, MAX_EDGE_SUPERSAMPLE,
};
use rt_core::scene::{RenderSettings, Scene, DENOISE_IMAGE, DENOISE_KEEP_NOISY};
use std::path::PathBuf;
use std::time::Duration;

/// Text printed by `rt --help` and after a usage error.
pub const USAGE: &str = "\
rt: Repackshot command line renderer

USAGE:
    rt <scene.rsb> -o <out.png> [--samples N] [--threads N] [--size WxH] [--max-seconds S]
       [--denoise] [--denoise-strength S] [--keep-noisy] [--caustics N] [--caustic-radius R]
       [--format F] [--bits N] [--pixel-filter F] [--edge-samples K]
    rt --example -o <out.png> [--samples N] [--threads N] [--size WxH] [--max-seconds S]
    rt --sheet <dir> [--samples N] [--threads N] [--size WxH]
    rt --pattern-sheet <dir> --materials <patterns.rsb> [--only wood|cloth] [--samples N]
       [--threads N] [--size WxH]
    rt --filter-sheet <dir> [--samples N] [--threads N] [--size WxH] [--only keys]
    rt --filter-noise <dir> [--samples N] [--threads N] [--size WxH] [--only keys]
    rt --lens-sheet <dir> [--samples N] [--threads N] [--size WxH] [--only keys]
    rt --lens-cost <dir> [--samples N] [--size WxH]
    rt --tilt-sheet <dir> [--samples N] [--threads N] [--size WxH]
    rt --write-example <scene.rsb>
    rt --write-e5-example <scene.rsb>
    rt --write-e5c-example <scene.rsb>
    rt --write-e5b-example <scene.rsb>
    rt --write-e6-example <scene.rsb>
    rt --write-e6-patterns-example <scene.rsb>
    rt --write-e6-cloth-example <scene.rsb>
    rt --write-m2b-example <scene.rsb>
    rt --write-m3b-example <scene.rsb>
    rt --write-m3c-wood-example <scene.rsb>
    rt --write-m3c-cloth-example <scene.rsb>
    rt --write-e9-example <scene.rsb>
    rt --sss-sheet <dir> [--samples N] [--threads N] [--size WxH]
    rt --adaptive-noise <dir> [--samples N] [--threads N] [--size WxH] [--max-seconds S]
       [--rounds N]
    rt --write-e11-example <scene.rsb>
    rt --write-q1-example <scene.rsb>
    rt --write-ambient-example <scene.rsb>
    rt --write-o1-example <scene.rsb>
    rt --write-o3a-example <scene.rsb>
    rt --write-film-thumb <scene.rsb>
    rt --write-o2-example <scene.rsb>
    rt --write-o4-example <scene.rsb>
    rt --write-l5-example <scene.rsb>
    rt --write-k3-plan-example <scene.rsb>
    rt --write-k3-panorama-example <scene.rsb>
    rt --write-k3-fisheye-example <scene.rsb>
    rt --write-lens-catalogue <file.json>
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
        --denoise-strength <S>
                            how much of the denoised image, 0 to 1 (RNDR.denoise_strength;
                            default 1): the image without denoise × (1 − S) + denoised × S;
                            0 writes the image without denoise
        --keep-noisy        with --denoise, also write the image without denoise next to it
                            (<out>-noisy.png)
        --adaptive          sample adaptively (RNDR.adaptive, E10): rounds of samples go to the
                            noisiest 8x8 blocks, at most --samples per pixel
        --noise <P>         with adaptive sampling, stop once every block's relative error of
                            the mean is under P percent (RNDR.noise_threshold, 0.5 to 5 in the
                            interface; implies --adaptive)
        --caustics <N>      trace N caustic photons per sample (RNDR.caustic_photons; 0: off)
        --caustic-radius <R>
                            first gather radius of the caustics in pixels (default 3)
        --pixel-filter <F>  where the samples go in their pixel (RNDR.pixel_filter): none
                            (the centre), standard (a box of 1 px, the default), soft (a
                            tent of 2 px) or fine (Blackman-Harris of 3 px)
        --edge-samples <K>  samples per sample index of the edge pixels, 1 to 16
                            (RNDR.edge_supersample; default 1)
        --example           render the built-in example scene instead of a file
        --sheet <dir>       render the example part under six built-in light recipes, the
                            E5 scenes (glass, coat, emitter, sky, HDRI) and the E5c skies
                            (physical against classic) into <dir>: one PNG each, index.html
                            and stats.json
        --pattern-sheet <dir>
                            render the woods and cloths of --materials
                            (tests/fixtures/patterns.rsb, the interface's own) as spheres and
                            boxes, before and after E6 and close up, into
                            <dir>/wood-sheet.html and <dir>/cloth-sheet.html (images in
                            <dir>/patterns/)
        --materials <f>     the materials of --pattern-sheet
        --filter-sheet <dir>
                            render the perfume bottle through every effect filter of the lens
                            at three grades, two stacks and none (512x384, 128 spp) into <dir>:
                            one PNG each and index.json (tools/lens-filters-sheet.mjs)
        --filter-noise <dir>
                            measure the noise of the effect filters on the same bottle, with
                            and without their connections to the lights (192x144, 16 spp, six
                            seeds; the variance of a pixel between the seeds) into
                            <dir>/noise.json
        --tilt-sheet <dir>  render lights on a floor through the simple lens and the traced double
                            Gauss, upright and tilted onto the floor, and their 2 x 2 composite
                            (O4)
        --lens-sheet <dir>  render the perfume bottle through each traced lens of the catalogue
                            wide open and at f/8, points of light through each wide open and
                            through the thin lens at that f-number, and a chart in focus at the
                            lens's own field (400x300, 96 spp) into <dir>: one PNG each and
                            index.json with the engine's numbers of each lens
                            (tools/lens-sheet.mjs)
        --lens-cost <dir>   measure the traced camera on one thread: the O2 example through the
                            double Gauss and through the thin lens (64x48, 1024 spp) and their
                            camera samples alone, and the camera sample of every lens, into
                            <dir>/cost.json
        --only <keys>       with --filter-sheet or --lens-sheet: only those cells (comma
                            separated), the others kept in index.json; with --filter-noise, only
                            those filters; with --pattern-sheet, wood or cloth: only that one of
                            its two sheets
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
        --write-e6-example <f>
                            write the E6 parity scene (bevelled CAD-like parts) as an RSB
                            file
        --write-e6-patterns-example <f>
                            write the E6 pattern scene (procedural wood) as an RSB file
        --write-e6-cloth-example <f>
                            write the E6 cloth scene (procedural cloth) as an RSB file
        --write-m2b-example <f>
                            write the M2b texture scene (image textures of every
                            projection, normal and height maps, cut-outs, emission, labels)
                            as an RSB file
        --write-m3b-example <f>
                            write the M3b scene of material programs (node materials run
                            by the engine: noise, ramps, a bump, an image, cut-outs,
                            curvature, emission, glass) as an RSB file
        --write-m3c-wood-example <f>
                            write the M3c wood scene (the E6 pattern scene drawn by WOOD
                            nodes of material programs) as an RSB file
        --write-m3c-cloth-example <f>
                            write the M3c cloth scene (the E6 cloth scene drawn by CLOTH
                            nodes of material programs) as an RSB file
        --write-e9-example <f>
                            write the E9 parity scene (the E5 scene with a scattering
                            medium in its big sphere and a dispersive crystal sphere) as
                            an RSB file
        --sss-sheet <dir>   render the E9 contact sheet of the scattering media (each
                            recipe as a sphere, the perfume bottle filled with milk and
                            juice, with and without the medium, the milk bottle with
                            caustic photons, at N and 4 N samples, default 64) into
                            <dir>: sss-sheet.html and sss/*.png
        --write-e11-example <f>
                            write the E11 parity scene (the example with the fine filter and
                            twice the samples on its edges) as an RSB file
        --write-q1-example <f>
                            write the Q1 parity scene (the E5 scene, glass sphere and cards,
                            cut in half by a section plane that caps the cut) as an RSB file
        --write-ambient-example <f>
                            write the S4a parity scene (the example with dust, rain and
                            snow: three ambient effects) as an RSB file
        --write-o1-example <f>
                            write the O1 parity scene (the example through a lens with every
                            knob of the enhanced thin lens, and bokeh lights) as an RSB file
        --write-l5-example <f>
                            write the L5 parity scene (the example lit by two IES lights, a
                            downlight profile and a wall washer, whose files travel in the
                            IESP sections) as an RSB file
        --write-k3-plan-example <f>
        --write-k3-panorama-example <f>
        --write-k3-fisheye-example <f>
                            write a K3 parity scene (a room of boxes lit by an uplight and the
                            sky through a window): its plan from above, orthographic, with the
                            ceiling hidden to the camera; an equirectangular panorama from
                            inside; an equidistant fisheye) as an RSB file
        --write-o3a-example <f>
                            write the O3a parity scene (the example through a stack of three
                            effect filters on the lens, and bokeh lights) as an RSB file
        --write-film-thumb <f>
                            write the base scene of the film plugin's recipe thumbnails (the
                            perfume bottle beside the table lamp, 320x200) as an RSB file
        --write-e10-example <f>
                            write the E10 parity scene (the E5b-1 scene sampled adaptively to
                            a noise target) as an RSB file
        --rounds <N>        --adaptive-noise: seeds per scene (default 3); with --noise, the
                            adaptive renders go to that target
        --write-o2-example <f>
                            write the O2 parity scene (the example through the traced double
                            Gauss, and bokeh lights) as an RSB file
        --write-o4-example <f>
                            write the O4 parity scene (the O2 scene with the traced lens tilted
                            and shifted) as an RSB file
        --write-lens-catalogue <f>
                            write the prescriptions of the 16 lenses of src/data/lenses.json as
                            the engine reads them (tests/fixtures/lens-catalogue.json)
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
    /// `--denoise-strength`: how much of the denoised image (U11b), overriding the scene's.
    pub denoise_strength: Option<f32>,
    /// Caustic photons per sample, overriding the scene's.
    pub caustics: Option<u32>,
    /// First caustic gather radius in pixels, overriding the scene's.
    pub caustic_radius: Option<f32>,
    /// `--pixel-filter`: the pixel filter (E11, `RNDR.pixel_filter`), overriding the scene's.
    pub pixel_filter: Option<u32>,
    /// `--edge-samples`: the samples of an edge pixel per sample index (E11), overriding the
    /// scene's.
    pub edge_samples: Option<u32>,
    /// `--adaptive` / `--noise`: adaptive sampling (E10), with this noise target (0: none),
    /// overriding the scene's.
    pub adaptive: Option<f32>,
    /// `--rounds`: rounds of `--adaptive-noise`.
    pub rounds: Option<u32>,
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
            // The particles' minimum size on screen depends on the image size.
            scene.refresh_particles();
        }
        if self.denoise {
            scene.render.denoise |= DENOISE_IMAGE;
        }
        if self.keep_noisy {
            scene.render.denoise |= DENOISE_KEEP_NOISY;
        }
        if let Some(strength) = self.denoise_strength {
            scene.render.denoise_strength = strength;
        }
        if let Some(photons) = self.caustics {
            scene.render.caustic_photons = photons;
        }
        if let Some(radius) = self.caustic_radius {
            scene.render.caustic_radius = radius;
        }
        if let Some(filter) = self.pixel_filter {
            scene.render.pixel_filter = filter;
        }
        if let Some(k) = self.edge_samples {
            scene.render.edge_supersample = k;
        }
        if let Some(target) = self.adaptive {
            scene.render.adaptive |= rt_core::adaptive::ADAPTIVE_ON;
            scene.render.noise_threshold = target;
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

/// The views of the K3 parity room (`rt --write-k3-*-example`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum K3View {
    /// `rt_core::example::k3_plan_scene`: the plan from above, the ceiling hidden to the camera.
    Plan,
    /// `rt_core::example::k3_panorama_scene`: the equirectangular panorama from inside.
    Panorama,
    /// `rt_core::example::k3_fisheye_scene`: the equidistant fisheye.
    Fisheye,
}

impl K3View {
    /// The parity scene of this view.
    pub fn scene(self) -> rt_core::scene::Scene {
        match self {
            K3View::Plan => rt_core::example::k3_plan_scene(),
            K3View::Panorama => rt_core::example::k3_panorama_scene(),
            K3View::Fisheye => rt_core::example::k3_fisheye_scene(),
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
    /// Render the pattern sheets into a directory.
    PatternSheet {
        /// Output directory.
        dir: PathBuf,
        /// The fixture with the materials (`tests/fixtures/patterns.rsb`).
        materials: PathBuf,
        /// Only this kind of pattern (`rt_core::pattern::PATTERN_WOOD` or `PATTERN_CLOTH`).
        only: Option<u32>,
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
    /// Render the sheet of the traced lenses (O2) into a directory.
    LensSheet {
        /// Output directory.
        dir: PathBuf,
        /// Overrides (samples, threads, size).
        options: Options,
        /// Only these cells (`--only key,key`), the others kept from `index.json`.
        only: Vec<String>,
    },
    /// Measure what the traced camera costs (O2) into a directory (`cost.json`).
    /// Render the sheet of the tilted lens (O4) into a directory.
    TiltSheet {
        /// Output directory.
        dir: PathBuf,
        /// Overrides (samples, threads, size).
        options: Options,
    },
    LensCost {
        /// Output directory.
        dir: PathBuf,
        /// Overrides (samples, size).
        options: Options,
    },
    /// Measure the noise of the effect filters with and without their connections (O3a).
    FilterNoise {
        /// Output directory (`noise.json`).
        dir: PathBuf,
        /// Overrides (samples, threads, size).
        options: Options,
        /// Only these filters (`--only key,key`).
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
    /// Write the E6 parity scene (`rt_core::example::e6_scene`) as an RSB file.
    WriteE6Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the E6 pattern scene (`rt_core::example::e6_patterns_scene`) as an RSB file.
    WriteE6PatternsExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the E6 cloth scene (`rt_core::example::e6_cloth_scene`) as an RSB file.
    WriteE6ClothExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the M2b texture scene (`rt_core::example::m2b_scene`) as an RSB file.
    WriteM2bExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the M3b scene of material programs (`rt_core::example::m3b_scene`) as an RSB file.
    WriteM3bExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the M3c wood scene of pattern nodes (`rt_core::example::m3c_wood_scene`).
    WriteM3cWoodExample {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the M3c cloth scene of pattern nodes (`rt_core::example::m3c_cloth_scene`).
    WriteM3cClothExample {
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
    /// Measure adaptive sampling against uniform sampling at equal time (E10).
    AdaptiveNoise {
        /// Output directory (`noise.json`).
        dir: PathBuf,
        /// Overrides (reference samples, threads, size, seconds per render, rounds).
        options: Options,
    },
    /// Write the E10 parity scene (`rt_core::example::e10_scene`) as an RSB file.
    WriteE10Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the E11 parity scene (`rt_core::example::e11_scene`) as an RSB file.
    WriteE11Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the Q1 parity scene (`rt_core::example::q1_scene`) as an RSB file.
    WriteQ1Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the L5 parity scene (`rt_core::example::l5_scene`) as an RSB file.
    WriteL5Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write a K3 parity scene (`rt_core::example::k3_plan_scene`, `k3_panorama_scene` or
    /// `k3_fisheye_scene`) as an RSB file.
    WriteK3Example {
        /// Which view of the room.
        view: K3View,
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the S4a parity scene (`rt_core::example::ambient_scene`) as an RSB file.
    WriteAmbientExample {
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
    /// Write the base scene of the film plugin's thumbnails (`scenes::film_thumb`) as an RSB file.
    WriteFilmThumb {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the catalogue's prescriptions as the engine reads them (O2).
    WriteLensCatalogue {
        /// JSON file to write.
        path: PathBuf,
    },
    /// Write the O2 parity scene (`rt_core::example::o2_scene`) as an RSB file.
    WriteO2Example {
        /// RSB file to write.
        path: PathBuf,
    },
    /// Write the O4 parity scene (`rt_core::example::o4_scene`) as an RSB file.
    WriteO4Example {
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
    let mut write_e6 = None;
    let mut write_e6p = None;
    let mut write_e6cloth = None;
    let mut write_m2b = None;
    let mut write_m3b = None;
    let mut write_m3c_wood = None;
    let mut write_m3c_cloth = None;
    let mut write_e9 = None;
    let mut sss_dir = None;
    let mut write_e11 = None;
    let mut write_q1 = None;
    let mut write_l5 = None;
    let mut write_k3 = None;
    let mut write_e10 = None;
    let mut adaptive_noise_dir = None;
    let mut write_ambient = None;
    let mut write_o1 = None;
    let mut write_o3a = None;
    let mut write_film_thumb = None;
    let mut write_o2 = None;
    let mut write_o4 = None;
    let mut write_lens_catalogue = None;
    let mut sheet_dir = None;
    let mut pattern_dir = None;
    let mut pattern_materials = None;
    let mut filter_sheet_dir = None;
    let mut filter_noise_dir = None;
    let mut lens_sheet_dir = None;
    let mut lens_cost_dir = None;
    let mut tilt_sheet_dir = None;
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
            "--denoise-strength" => {
                let text = value(&mut it, arg)?;
                match text.parse::<f32>() {
                    Ok(s) if (0.0..=1.0).contains(&s) => options.denoise_strength = Some(s),
                    _ => {
                        return Err(format!(
                            "--denoise-strength expects a number from 0 to 1, got '{text}'"
                        ))
                    }
                }
            }
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
            "--pixel-filter" => {
                let text = value(&mut it, arg)?;
                options.pixel_filter = Some(match text.as_str() {
                    "none" => FILTER_NONE,
                    "standard" => FILTER_STANDARD,
                    "soft" => FILTER_TENT,
                    "fine" => FILTER_BLACKMAN_HARRIS,
                    _ => {
                        return Err(format!(
                            "--pixel-filter expects none, standard, soft or fine, got '{text}'"
                        ))
                    }
                });
            }
            "--edge-samples" => {
                let text = value(&mut it, arg)?;
                match text.parse::<u32>() {
                    Ok(k) if (1..=MAX_EDGE_SUPERSAMPLE).contains(&k) => {
                        options.edge_samples = Some(k)
                    }
                    _ => {
                        return Err(format!(
                            "--edge-samples expects a number from 1 to {MAX_EDGE_SUPERSAMPLE}, got '{text}'"
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
            "--pattern-sheet" => pattern_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--materials" => pattern_materials = Some(PathBuf::from(value(&mut it, arg)?)),
            "--sss-sheet" => sss_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--filter-sheet" => filter_sheet_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--filter-noise" => filter_noise_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--lens-sheet" => lens_sheet_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--lens-cost" => lens_cost_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--tilt-sheet" => tilt_sheet_dir = Some(PathBuf::from(value(&mut it, arg)?)),
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
            "--write-e6-example" => write_e6 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-e6-patterns-example" => write_e6p = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-e6-cloth-example" => write_e6cloth = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-m2b-example" => write_m2b = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-m3b-example" => write_m3b = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-m3c-wood-example" => {
                write_m3c_wood = Some(PathBuf::from(value(&mut it, arg)?));
            }
            "--write-m3c-cloth-example" => {
                write_m3c_cloth = Some(PathBuf::from(value(&mut it, arg)?));
            }
            "--write-e9-example" => write_e9 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-e11-example" => write_e11 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-q1-example" => write_q1 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-l5-example" => write_l5 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-k3-plan-example" => {
                write_k3 = Some((K3View::Plan, PathBuf::from(value(&mut it, arg)?)))
            }
            "--write-k3-panorama-example" => {
                write_k3 = Some((K3View::Panorama, PathBuf::from(value(&mut it, arg)?)))
            }
            "--write-k3-fisheye-example" => {
                write_k3 = Some((K3View::Fisheye, PathBuf::from(value(&mut it, arg)?)))
            }
            "--write-e10-example" => write_e10 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--adaptive-noise" => adaptive_noise_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--rounds" => options.rounds = Some(positive(value(&mut it, arg)?, arg)?),
            "--adaptive" => {
                options.adaptive.get_or_insert(0.0);
            }
            "--noise" => {
                let text = value(&mut it, arg)?;
                match text.parse::<f32>() {
                    Ok(p) if (0.0..=100.0).contains(&p) => options.adaptive = Some(p / 100.0),
                    _ => {
                        return Err(format!(
                            "--noise expects a percentage from 0 to 100, got '{text}'"
                        ))
                    }
                }
            }
            "--write-ambient-example" => {
                write_ambient = Some(PathBuf::from(value(&mut it, arg)?));
            }
            "--write-o1-example" => write_o1 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-o3a-example" => write_o3a = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-film-thumb" => write_film_thumb = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-o2-example" => write_o2 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-o4-example" => write_o4 = Some(PathBuf::from(value(&mut it, arg)?)),
            "--write-lens-catalogue" => {
                write_lens_catalogue = Some(PathBuf::from(value(&mut it, arg)?))
            }
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
    if let Some(dir) = pattern_dir {
        let Some(materials) = pattern_materials else {
            return Err("--pattern-sheet needs --materials <patterns.rsb>".into());
        };
        if input.is_some() || output.is_some() || options.max_seconds.is_some() {
            return Err(
                "--pattern-sheet renders its own scenes: no scene, -o or --max-seconds".into(),
            );
        }
        let only = match only.as_slice() {
            [] => None,
            [kind] if kind == "wood" => Some(rt_core::pattern::PATTERN_WOOD),
            [kind] if kind == "cloth" => Some(rt_core::pattern::PATTERN_CLOTH),
            _ => {
                return Err(format!(
                    "--only takes wood or cloth with --pattern-sheet, not {}",
                    only.join(",")
                ))
            }
        };
        return Ok(Command::PatternSheet {
            dir,
            materials,
            only,
            options,
        });
    }
    if pattern_materials.is_some() {
        return Err("--materials goes with --pattern-sheet".into());
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
    if let Some(path) = write_e6 {
        if args.len() != 2 {
            return Err("--write-e6-example takes no other option".into());
        }
        return Ok(Command::WriteE6Example { path });
    }
    if let Some(path) = write_e6p {
        if args.len() != 2 {
            return Err("--write-e6-patterns-example takes no other option".into());
        }
        return Ok(Command::WriteE6PatternsExample { path });
    }
    if let Some(path) = write_e6cloth {
        if args.len() != 2 {
            return Err("--write-e6-cloth-example takes no other option".into());
        }
        return Ok(Command::WriteE6ClothExample { path });
    }
    if let Some(path) = write_m2b {
        if args.len() != 2 {
            return Err("--write-m2b-example takes no other option".into());
        }
        return Ok(Command::WriteM2bExample { path });
    }
    if let Some(path) = write_m3b {
        if args.len() != 2 {
            return Err("--write-m3b-example takes no other option".into());
        }
        return Ok(Command::WriteM3bExample { path });
    }
    if let Some(path) = write_m3c_wood {
        if args.len() != 2 {
            return Err("--write-m3c-wood-example takes no other option".into());
        }
        return Ok(Command::WriteM3cWoodExample { path });
    }
    if let Some(path) = write_m3c_cloth {
        if args.len() != 2 {
            return Err("--write-m3c-cloth-example takes no other option".into());
        }
        return Ok(Command::WriteM3cClothExample { path });
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
    if let Some(path) = write_e11 {
        if args.len() != 2 {
            return Err("--write-e11-example takes no other option".into());
        }
        return Ok(Command::WriteE11Example { path });
    }
    if let Some(path) = write_q1 {
        if args.len() != 2 {
            return Err("--write-q1-example takes no other option".into());
        }
        return Ok(Command::WriteQ1Example { path });
    }
    if let Some(path) = write_l5 {
        if args.len() != 2 {
            return Err("--write-l5-example takes no other option".into());
        }
        return Ok(Command::WriteL5Example { path });
    }
    if let Some((view, path)) = write_k3 {
        if args.len() != 2 {
            return Err("--write-k3-*-example takes no other option".into());
        }
        return Ok(Command::WriteK3Example { view, path });
    }
    if let Some(path) = write_e10 {
        if args.len() != 2 {
            return Err("--write-e10-example takes no other option".into());
        }
        return Ok(Command::WriteE10Example { path });
    }
    if let Some(dir) = adaptive_noise_dir {
        if input.is_some() || output.is_some() {
            return Err("--adaptive-noise renders its own scenes: no scene or -o".into());
        }
        return Ok(Command::AdaptiveNoise { dir, options });
    }
    if options.rounds.is_some() {
        return Err("--rounds goes with --adaptive-noise".into());
    }
    if let Some(path) = write_ambient {
        if args.len() != 2 {
            return Err("--write-ambient-example takes no other option".into());
        }
        return Ok(Command::WriteAmbientExample { path });
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
    if let Some(path) = write_film_thumb {
        if args.len() != 2 {
            return Err("--write-film-thumb takes no other option".into());
        }
        return Ok(Command::WriteFilmThumb { path });
    }
    if let Some(path) = write_lens_catalogue {
        if args.len() != 2 {
            return Err("--write-lens-catalogue takes no other option".into());
        }
        return Ok(Command::WriteLensCatalogue { path });
    }
    if let Some(path) = write_o2 {
        if args.len() != 2 {
            return Err("--write-o2-example takes no other option".into());
        }
        return Ok(Command::WriteO2Example { path });
    }
    if let Some(path) = write_o4 {
        if args.len() != 2 {
            return Err("--write-o4-example takes no other option".into());
        }
        return Ok(Command::WriteO4Example { path });
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
        if input.is_some()
            || output.is_some()
            || options.max_seconds.is_some()
            || filter_noise_dir.is_some()
        {
            return Err(
                "--filter-sheet renders its own scenes: no scene, -o, --max-seconds or --filter-noise"
                    .into(),
            );
        }
        return Ok(Command::FilterSheet { dir, options, only });
    }
    if let Some(dir) = lens_sheet_dir {
        if input.is_some()
            || output.is_some()
            || options.max_seconds.is_some()
            || filter_noise_dir.is_some()
        {
            return Err(
                "--lens-sheet renders its own scenes: no scene, -o, --max-seconds or --filter-noise"
                    .into(),
            );
        }
        return Ok(Command::LensSheet { dir, options, only });
    }
    if let Some(dir) = tilt_sheet_dir {
        if input.is_some()
            || output.is_some()
            || options.max_seconds.is_some()
            || filter_noise_dir.is_some()
            || !only.is_empty()
        {
            return Err(
                "--tilt-sheet renders its own scenes: no scene, -o, --max-seconds, --only or --filter-noise"
                    .into(),
            );
        }
        return Ok(Command::TiltSheet { dir, options });
    }
    if let Some(dir) = lens_cost_dir {
        if input.is_some()
            || output.is_some()
            || options.max_seconds.is_some()
            || filter_noise_dir.is_some()
            || !only.is_empty()
        {
            return Err(
                "--lens-cost renders its own scenes: no scene, -o, --max-seconds, --only or --filter-noise"
                    .into(),
            );
        }
        return Ok(Command::LensCost { dir, options });
    }
    if let Some(dir) = filter_noise_dir {
        if input.is_some() || output.is_some() || options.max_seconds.is_some() {
            return Err(
                "--filter-noise renders its own scenes: no scene, -o or --max-seconds".into(),
            );
        }
        return Ok(Command::FilterNoise { dir, options, only });
    }
    if !only.is_empty() {
        return Err(
            "--only goes with --pattern-sheet, --filter-sheet, --filter-noise or --lens-sheet"
                .into(),
        );
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
        Command::WriteE6Example { path } => {
            let bytes = rt_core::example::e6_scene().to_rsb();
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
        Command::WriteE10Example { path } => {
            let bytes = rt_core::example::e10_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::AdaptiveNoise { dir, options } => {
            let size = options.size.unwrap_or((320, 240));
            let reference = options.samples.unwrap_or(4096);
            let seconds = f64::from(options.max_seconds.unwrap_or(10.0));
            let rounds = options.rounds.unwrap_or(3);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            println!(
                "adaptive noise: {}x{}, {seconds} s per render, reference {reference} spp, {rounds} rounds, {threads} threads",
                size.0, size.1
            );
            let target = options.adaptive.unwrap_or(0.0);
            let table = crate::adaptive_noise::run(
                &dir, size, seconds, reference, rounds, threads, target,
            )?;
            print!("{table}");
            println!("wrote {}", dir.join("noise.json").display());
            Ok(())
        }
        Command::WriteQ1Example { path } => {
            let bytes = rt_core::example::q1_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteE11Example { path } => {
            let bytes = rt_core::example::e11_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteL5Example { path } => {
            let bytes = rt_core::example::l5_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteK3Example { view, path } => {
            let bytes = view.scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteE6PatternsExample { path } => {
            let bytes = rt_core::example::e6_patterns_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteAmbientExample { path } => {
            let bytes = rt_core::example::ambient_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteE6ClothExample { path } => {
            let bytes = rt_core::example::e6_cloth_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteM2bExample { path } => {
            let bytes = rt_core::example::m2b_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteM3bExample { path } => {
            let bytes = rt_core::example::m3b_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteM3cWoodExample { path } => {
            let bytes = rt_core::example::m3c_wood_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteM3cClothExample { path } => {
            let bytes = rt_core::example::m3c_cloth_scene().to_rsb();
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
        Command::WriteFilmThumb { path } => {
            let bytes = crate::scenes::film_thumb(crate::scenes::FILM_THUMB_SIZE).to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteLensCatalogue { path } => {
            let text = crate::lens_catalogue::catalogue_json();
            std::fs::write(&path, &text).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), text.len());
            Ok(())
        }
        Command::WriteO2Example { path } => {
            let bytes = rt_core::example::o2_scene().to_rsb();
            std::fs::write(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
            Ok(())
        }
        Command::WriteO4Example { path } => {
            let bytes = rt_core::example::o4_scene().to_rsb();
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
        Command::PatternSheet {
            dir,
            materials,
            only,
            options,
        } => {
            use crate::pattern_sheet as ps;
            let bytes =
                std::fs::read(&materials).map_err(|e| format!("{}: {e}", materials.display()))?;
            let mut list =
                ps::read_materials(&bytes).map_err(|e| format!("{}: {e}", materials.display()))?;
            if let Some(kind) = only {
                list.retain(|m| m.pattern.kind == kind);
            }
            let size = options.size.unwrap_or(ps::SHEET_SIZE);
            let samples = options.samples.unwrap_or(ps::SHEET_SAMPLES);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            println!(
                "pattern sheet: {} materials, {}x{}, {samples} spp, {threads} threads",
                list.len(),
                size.0,
                size.1
            );
            let (woods, cloths) = ps::run(&dir, &list, size, samples, threads)?;
            for (name, rows) in [("wood-sheet.html", woods), ("cloth-sheet.html", cloths)] {
                if !rows.is_empty() {
                    println!(
                        "wrote {} ({} materials)",
                        dir.join(name).display(),
                        rows.len()
                    );
                }
            }
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
        Command::LensSheet { dir, options, only } => {
            use crate::lens_sheet::{run, LENS_SHEET_SAMPLES, LENS_SHEET_SIZE};
            let size = options.size.unwrap_or(LENS_SHEET_SIZE);
            let samples = options.samples.unwrap_or(LENS_SHEET_SAMPLES);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            println!(
                "lens sheet: {}x{}, {samples} spp, {threads} threads",
                size.0, size.1
            );
            let n = run(&dir, size, samples, threads, &only)?;
            println!("wrote {n} images and {}", dir.join("index.json").display());
            Ok(())
        }
        Command::TiltSheet { dir, options } => {
            use crate::tilt_sheet::{run, TILT_SHEET_SAMPLES, TILT_SHEET_SIZE};
            let size = options.size.unwrap_or(TILT_SHEET_SIZE);
            let samples = options.samples.unwrap_or(TILT_SHEET_SAMPLES);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            println!(
                "tilt sheet: {}x{}, {samples} spp, {threads} threads",
                size.0, size.1
            );
            let n = run(&dir, size, samples, threads)?;
            println!(
                "wrote {n} images and {}",
                dir.join("composite.png").display()
            );
            Ok(())
        }
        Command::LensCost { dir, options } => {
            use crate::lens_sheet::{cost, COST_SAMPLES, COST_SIZE};
            let size = options.size.unwrap_or(COST_SIZE);
            let samples = options.samples.unwrap_or(COST_SAMPLES);
            println!(
                "lens cost: {}x{}, {samples} spp, one thread",
                size.0, size.1
            );
            let path = cost(&dir, samples, size)?;
            println!("wrote {path}");
            Ok(())
        }
        Command::FilterNoise { dir, options, only } => {
            use crate::filter_sheet::{noise, NOISE_RUNS, NOISE_SAMPLES, NOISE_SIZE};
            let size = options.size.unwrap_or(NOISE_SIZE);
            let samples = options.samples.unwrap_or(NOISE_SAMPLES);
            let threads = options
                .threads
                .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
            println!(
                "filter noise: {}x{}, {samples} spp, {NOISE_RUNS} seeds, {threads} threads",
                size.0, size.1
            );
            let rows = noise(&dir, size, samples, NOISE_RUNS, threads, &only)?;
            println!(
                "wrote {} rows to {}",
                rows.len(),
                dir.join("noise.json").display()
            );
            Ok(())
        }
        Command::Render {
            input,
            output,
            options,
        } => {
            let started = std::time::Instant::now();
            let mut scene = match &input {
                Input::Example => rt_core::example::scene(),
                Input::File(path) => {
                    let bytes =
                        std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
                    Scene::from_rsb(&bytes).map_err(|e| format!("{}: {e}", path.display()))?
                }
            };
            let (samples, threads) = options.apply(&mut scene);
            let loaded = started.elapsed();
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
            if !scene.effects.is_empty() {
                println!(
                    "ambient: {} particles in {} effects, evaluated with their BVHs in {:.3} s",
                    scene.geometry.particle_count(),
                    scene.effects.len(),
                    loaded.as_secs_f64()
                );
            }

            let result = render_progressive(&scene, samples, threads, budget);
            println!(
                "rendered {} spp, {} rays in {:.3} s ({:.2} Mrays/s)",
                result.samples,
                result.rays,
                result.elapsed.as_secs_f64(),
                result.rays_per_second() / 1.0e6
            );
            if let Some(a) = result.adaptive {
                println!(
                    "adaptive: {} to {} spp in {} rounds, {}{}",
                    a.min,
                    a.max,
                    a.rounds,
                    if a.converged { "converged" } else { "stopped" },
                    a.last.map_or(String::new(), |d| format!(
                        ", the noisiest block at {:.2} %",
                        d.max_error * 100.0
                    ))
                );
            }

            let spec = OutputSpec::resolve(options.format, options.bits, &output)?;
            let (exposure_ev, tonemap) = (
                scene.render.exposure_ev,
                Tonemap::from_u32(scene.render.tonemap),
            );
            let write = |path: &std::path::Path, film: &rt_core::image::Film| {
                write_file(path, &encode_film(film, exposure_ev, tonemap, spec))
                    .map_err(|e| format!("{}: {e}", path.display()))
            };
            // U11b: at a strength of 0 nothing is denoised (the image is the one without).
            if scene.render.denoise & DENOISE_IMAGE != 0 && scene.render.denoise_strength > 0.0 {
                let t0 = std::time::Instant::now();
                let clean = result
                    .denoised_at(threads, scene.render.denoise_strength)
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
    fn parses_adaptive_sampling_and_its_noise_target() {
        let Ok(Command::Render { options, .. }) =
            parse(&["--example", "-o", "o.png", "--adaptive"])
        else {
            panic!("render");
        };
        assert_eq!(options.adaptive, Some(0.0));
        let Ok(Command::Render { options, .. }) =
            parse(&["--example", "-o", "o.png", "--noise", "1.5"])
        else {
            panic!("render");
        };
        assert_eq!(options.adaptive, Some(0.015));
        let mut scene = rt_core::example::scene();
        options.apply(&mut scene);
        assert_eq!(scene.render.adaptive, rt_core::adaptive::ADAPTIVE_ON);
        assert_eq!(scene.render.noise_threshold, 0.015);
        assert!(parse(&["--example", "-o", "o.png", "--noise", "x"]).is_err());
        assert!(parse(&["--example", "-o", "o.png", "--rounds", "2"]).is_err());
        assert!(matches!(
            parse(&["--adaptive-noise", "dir", "--rounds", "2", "--noise", "1"]),
            Ok(Command::AdaptiveNoise { .. })
        ));
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
        // U11b: the strength of the denoise, 0 to 1.
        assert_eq!(
            parse(&[
                "--example",
                "-o",
                "x.png",
                "--denoise",
                "--denoise-strength",
                "0.25"
            ]),
            Ok(Command::Render {
                input: Input::Example,
                output: "x.png".into(),
                options: Options {
                    denoise: true,
                    denoise_strength: Some(0.25),
                    ..Options::default()
                },
            })
        );
        for bad in ["1.5", "-0.1", "half", "NaN"] {
            assert!(
                parse(&["--example", "-o", "x.png", "--denoise-strength", bad]).is_err(),
                "{bad}"
            );
        }
        // E11: the pixel filter by name and the edge samples, 1 to 16.
        for (name, filter) in [
            ("none", FILTER_NONE),
            ("standard", FILTER_STANDARD),
            ("soft", FILTER_TENT),
            ("fine", FILTER_BLACKMAN_HARRIS),
        ] {
            assert_eq!(
                parse(&[
                    "--example",
                    "-o",
                    "x.png",
                    "--pixel-filter",
                    name,
                    "--edge-samples",
                    "2"
                ]),
                Ok(Command::Render {
                    input: Input::Example,
                    output: "x.png".into(),
                    options: Options {
                        pixel_filter: Some(filter),
                        edge_samples: Some(2),
                        ..Options::default()
                    },
                })
            );
        }
        assert!(parse(&["--example", "-o", "x.png", "--pixel-filter", "gauss"]).is_err());
        for bad in ["0", "17", "two"] {
            assert!(
                parse(&["--example", "-o", "x.png", "--edge-samples", bad]).is_err(),
                "{bad}"
            );
        }
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
    fn parses_the_pattern_sheet() {
        assert_eq!(
            parse(&[
                "--pattern-sheet",
                "out",
                "--materials",
                "p.rsb",
                "--samples",
                "8"
            ]),
            Ok(Command::PatternSheet {
                dir: "out".into(),
                materials: "p.rsb".into(),
                only: None,
                options: Options {
                    samples: Some(8),
                    ..Options::default()
                },
            })
        );
        assert_eq!(
            parse(&[
                "--pattern-sheet",
                "out",
                "--materials",
                "p.rsb",
                "--only",
                "cloth"
            ]),
            Ok(Command::PatternSheet {
                dir: "out".into(),
                materials: "p.rsb".into(),
                only: Some(rt_core::pattern::PATTERN_CLOTH),
                options: Options::default(),
            })
        );
        assert!(parse(&[
            "--pattern-sheet",
            "out",
            "--materials",
            "p.rsb",
            "--only",
            "glass"
        ])
        .is_err());
        assert!(parse(&["--only", "wood", "--example", "-o", "x.png"]).is_err());
        assert!(parse(&["--pattern-sheet", "out"]).is_err());
        assert!(parse(&["--materials", "p.rsb", "--example", "-o", "x.png"]).is_err());
        assert!(parse(&[
            "--pattern-sheet",
            "out",
            "--materials",
            "p.rsb",
            "-o",
            "x.png"
        ])
        .is_err());
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
            parse(&["--write-e6-example", "e6.rsb"]),
            Ok(Command::WriteE6Example {
                path: "e6.rsb".into()
            })
        );
        assert!(parse(&["--write-e6-example", "e6.rsb", "--example"]).is_err());
        assert_eq!(
            parse(&["--write-e6-patterns-example", "p.rsb"]),
            Ok(Command::WriteE6PatternsExample {
                path: "p.rsb".into()
            })
        );
        assert_eq!(
            parse(&["--write-e6-cloth-example", "c.rsb"]),
            Ok(Command::WriteE6ClothExample {
                path: "c.rsb".into()
            })
        );
        assert!(parse(&["--write-e6-cloth-example", "c.rsb", "--samples", "2"]).is_err());
        assert_eq!(
            parse(&["--write-m2b-example", "m.rsb"]),
            Ok(Command::WriteM2bExample {
                path: "m.rsb".into()
            })
        );
        assert!(parse(&["--write-m2b-example", "m.rsb", "--samples", "2"]).is_err());
        assert_eq!(
            parse(&["--write-m3b-example", "p.rsb"]),
            Ok(Command::WriteM3bExample {
                path: "p.rsb".into()
            })
        );
        assert!(parse(&["--write-m3b-example", "p.rsb", "--samples", "2"]).is_err());
        assert_eq!(
            parse(&["--write-m3c-wood-example", "w.rsb"]),
            Ok(Command::WriteM3cWoodExample {
                path: "w.rsb".into()
            })
        );
        assert_eq!(
            parse(&["--write-m3c-cloth-example", "c.rsb"]),
            Ok(Command::WriteM3cClothExample {
                path: "c.rsb".into()
            })
        );
        assert!(parse(&["--write-m3c-wood-example", "w.rsb", "--samples", "2"]).is_err());
        assert_eq!(
            parse(&["--write-ambient-example", "s4a.rsb"]),
            Ok(Command::WriteAmbientExample {
                path: "s4a.rsb".into()
            })
        );
        assert!(parse(&["--write-ambient-example", "s4a.rsb", "--samples", "2"]).is_err());
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
        assert_eq!(
            parse(&[
                "--filter-noise",
                "out",
                "--only",
                "star--1",
                "--samples",
                "8"
            ]),
            Ok(Command::FilterNoise {
                dir: "out".into(),
                options: Options {
                    samples: Some(8),
                    ..Options::default()
                },
                only: vec!["star--1".into()],
            })
        );
        assert!(parse(&["--filter-noise", "out", "-o", "a.png"]).is_err());
        assert_eq!(
            parse(&["--lens-sheet", "out", "--only", "triplet--bottle--f8"]),
            Ok(Command::LensSheet {
                dir: "out".into(),
                options: Options::default(),
                only: vec!["triplet--bottle--f8".into()],
            })
        );
        assert!(parse(&["--lens-sheet", "out", "scene.rsb"]).is_err());
        assert_eq!(
            parse(&["--lens-cost", "out", "--samples", "8"]),
            Ok(Command::LensCost {
                dir: "out".into(),
                options: Options {
                    samples: Some(8),
                    ..Options::default()
                },
            })
        );
        assert!(parse(&["--lens-cost", "out", "--only", "a"]).is_err());
        assert_eq!(
            parse(&["--write-lens-catalogue", "c.json"]),
            Ok(Command::WriteLensCatalogue {
                path: "c.json".into()
            })
        );
        assert!(parse(&["--filter-noise", "out", "--filter-sheet", "out"]).is_err());
        assert_eq!(
            parse(&["--write-film-thumb", "t.rsb"]),
            Ok(Command::WriteFilmThumb {
                path: "t.rsb".into()
            })
        );
        assert!(parse(&["--write-film-thumb", "t.rsb", "--samples", "2"]).is_err());
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
            denoise_strength: Some(0.5),
            caustics: Some(4096),
            caustic_radius: Some(2.0),
            pixel_filter: Some(FILTER_TENT),
            edge_samples: Some(4),
            ..Options::default()
        }
        .apply(&mut scene);
        assert_eq!(scene.render.denoise_strength, 0.5);
        assert_eq!(
            (scene.render.pixel_filter, scene.render.edge_supersample),
            (FILTER_TENT, 4)
        );
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

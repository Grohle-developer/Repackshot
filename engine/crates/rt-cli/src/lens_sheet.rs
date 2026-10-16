//! The sheet of the traced lenses (O2, `rt --lens-sheet <dir>`; `tools/lens-sheet.mjs` writes its
//! page) and the cost of the traced camera (`rt --lens-cost <dir>`).
//!
//! For each of the 16 lenses of the catalogue (the anamorphic adapter in front of the double
//! Gauss): the perfume bottle of the filter sheet wide open and at f/8; a scene of points of light
//! far behind the focus, on black, wide open (the bokeh across the frame: cat's eye, bubble, creamy
//! blur, swirl, coma), and the same through the thin lens at the same f-number; and a chart of
//! small lights in focus on a rectilinear grid at the lens's own field, wide open (distortion and
//! falloff). With the thin lens of the bottle at f/2 and f/8 and of the chart, for comparison.

use crate::filter_sheet::filter_bottle;
use crate::lens_catalogue::{catalogue, CatalogueLens};
use crate::render_progressive;
use rt_core::color::Rgb;
use rt_core::math::Vec3;
use rt_core::optics::filters::FilterParams;
use rt_core::sampler::PixelSampler;
use rt_core::scene::{
    Camera, EnvKind, Environment, Floor, FloorMode, Geometry, Lens, LensParams, Light, LightKind,
    RenderSettings, Scene, LIGHT_FLAG_CAMERA,
};
use std::path::Path;
use std::time::Instant;

/// Size and samples of the sheet.
pub const LENS_SHEET_SIZE: (u32, u32) = (400, 300);
/// See [`LENS_SHEET_SIZE`].
pub const LENS_SHEET_SAMPLES: u32 = 96;
/// The stop of the second row of the bottle.
pub const CLOSED_FSTOP: f32 = 8.0;
/// The chart's distance from the camera, mm (in focus).
pub const CHART_DISTANCE_MM: f32 = 3000.0;
/// Lights per row and per column of the chart.
pub const CHART_GRID: (usize, usize) = (13, 9);
/// The focal length of the chart of a lens whose source states no field, by its character: a
/// tele at 135 mm, anything else at 50 mm.
pub const CHART_FOCAL_TELE: f32 = 135.0;
/// See [`CHART_FOCAL_TELE`].
pub const CHART_FOCAL_NORMAL: f32 = 50.0;
/// A fisheye's chart: the frame's corner just inside its image circle.
pub const CHART_FOCAL_FISHEYE: f32 = 18.0;

/// One image of the sheet.
pub struct LensCell {
    /// File name without the extension.
    pub key: String,
    /// The lens (catalogue key; empty for the thin lens of the bottle and the chart).
    pub lens: String,
    /// `bottle`, `points` or `chart`.
    pub scene_name: &'static str,
    /// Whether the camera traces the lens (false: the thin lens, for comparison).
    pub traced: bool,
    /// The camera's f-number (0: wide open).
    pub fstop: f32,
    /// The scene.
    pub scene: Scene,
}

/// `scene`'s camera through `lens` (the iris round): prepared for its optics.
pub fn with_lens(mut scene: Scene, lens: &CatalogueLens, fstop: f32) -> Result<Scene, String> {
    scene.camera.fstop = fstop;
    let params = LensParams {
        squeeze: lens.squeeze,
        obstruction: lens.obstruction,
        prescription: Some(lens.prescription.clone()),
        ..LensParams::default()
    };
    scene.camera.lens = Some(Lens::new(params).map_err(|e| format!("{}: {e}", lens.key))?);
    scene
        .camera
        .prepare_lens()
        .map_err(|e| format!("{}: {e}", lens.key))?;
    Ok(scene)
}

/// The f-number a traced lens works at in `scene` (the requested one, never faster than the lens).
fn traced_fstop(scene: &Scene) -> f32 {
    scene
        .camera
        .lens
        .as_ref()
        .and_then(|l| l.traced())
        .map_or(scene.camera.fstop, |t| t.info().f_number)
}

/// A camera at the origin looking along +y, z up.
fn camera(focal: f32, fstop: f32, focus: f32) -> Camera {
    Camera {
        position: Vec3::ZERO,
        target: Vec3::new(0.0, 1000.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        focal_mm: focal,
        sensor_mm: 36.0,
        fstop,
        focus_dist: focus,
        ortho: false,
        ortho_width: 1000.0,
        lens: None,
    }
}

/// The frame on the sensor, mm (the longer side 36).
fn frame(size: (u32, u32), sensor: f32) -> (f32, f32) {
    let aspect = size.0 as f32 / size.1 as f32;
    if aspect >= 1.0 {
        (sensor, sensor / aspect)
    } else {
        (sensor * aspect, sensor)
    }
}

/// A scene of `lights` on black, seen by camera rays only.
fn lights_scene(size: (u32, u32), camera: Camera, lights: Vec<Light>) -> Scene {
    Scene {
        camera,
        materials: Vec::new(),
        geometry: Geometry::default(),
        lights,
        environment: Environment {
            kind: EnvKind::Flat,
            floor: 0.0,
            horizon: 0.0,
            zenith: 0.0,
            strength: 0.0,
            ..Environment::default()
        },
        floor: Floor {
            mode: FloorMode::None,
            z: 0.0,
            color: Rgb::splat(0.0),
        },
        render: RenderSettings {
            width: size.0,
            height: size.1,
            max_depth: 2,
            ..RenderSettings::default()
        },
        bitmaps: Vec::new(),
        effects: Vec::new(),
    }
}

/// A disc of `radiance` and `diameter` at `position`, facing the camera at the origin.
fn disc(position: Vec3, diameter: f32, radiance: f32) -> Light {
    let area_m2 = std::f32::consts::PI * (diameter / 2000.0).powi(2);
    Light {
        kind: LightKind::Disk,
        position,
        direction: (Vec3::ZERO - position).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: diameter,
        size_y: diameter,
        color: Rgb::new(1.0, 0.97, 0.92),
        power: radiance * std::f32::consts::PI * area_m2,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_CAMERA,
    }
}

/// Points of light far behind the focus on black: an 85 mm focused at 600 mm, small discs 6 m
/// away in a 5 × 4 grid over the frame, seen by camera rays only (the thin lens of the camera at
/// `fstop`, or what a traced lens makes of it).
pub fn bokeh_points(size: (u32, u32), fstop: f32) -> Scene {
    let (focal, focus, depth, diameter) = (85.0f32, 600.0f32, 6000.0f32, 60.0f32);
    let (sw, sh) = frame(size, 36.0);
    // As bright as the bokeh thumbnails' (tools/bokeh-scene.mjs): a blur disc of an f/2 averages
    // about 0.45 before the tone curve.
    let blur = (focal / 2.0) * (depth - focus) / depth / focus;
    let radiance = 0.45 * (blur / (diameter / depth)).powi(2);
    let mut lights = Vec::new();
    for gx in [-0.8f32, -0.4, 0.0, 0.4, 0.8] {
        for gy in [-0.72f32, -0.24, 0.24, 0.72] {
            let x = gx * sw / 2.0 * depth / focal;
            let z = gy * sh / 2.0 * depth / focal;
            lights.push(disc(Vec3::new(x, depth, z), diameter, radiance));
        }
    }
    lights_scene(size, camera(focal, fstop, focus), lights)
}

/// The focal length of `lens`'s chart: the frame's diagonal across the field its source states
/// (a fisheye's corner near 85°), or by its character.
pub fn chart_focal(lens: &CatalogueLens, size: (u32, u32)) -> f32 {
    let (sw, sh) = frame(size, 36.0);
    let half_diagonal = 0.5 * (sw * sw + sh * sh).sqrt();
    let f = match lens.field_deg {
        Some(field) if field >= 170.0 => CHART_FOCAL_FISHEYE,
        Some(field) => half_diagonal / (0.5 * field.to_radians()).tan(),
        None if lens.character == "tele" => CHART_FOCAL_TELE,
        None => CHART_FOCAL_NORMAL,
    };
    (f * 10.0).round() / 10.0
}

/// A chart in focus: small discs of one radiance at [`CHART_DISTANCE_MM`] on a rectilinear grid
/// that fills the frame of a lens without distortion (a grid of [`CHART_GRID`]), each about two
/// pixels across, on black: distortion bends its rows and columns, falloff dims its corners.
pub fn chart(size: (u32, u32), focal: f32, fstop: f32) -> Scene {
    let depth = CHART_DISTANCE_MM;
    let (sw, sh) = frame(size, 36.0);
    let pixel = sw / size.0 as f32 * depth / focal;
    let diameter = 2.0 * pixel;
    let (nx, ny) = CHART_GRID;
    let mut lights = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            let gx = -1.0 + 2.0 * i as f32 / (nx - 1) as f32;
            let gy = -1.0 + 2.0 * j as f32 / (ny - 1) as f32;
            // Half a pixel's margin inside the frame, so the outer rows show.
            let x = gx * (sw / 2.0 - 2.0 * sw / size.0 as f32) * depth / focal;
            let z = gy * (sh / 2.0 - 2.0 * sh / size.1 as f32) * depth / focal;
            lights.push(disc(Vec3::new(x, depth, z), diameter, 0.9));
        }
    }
    lights_scene(size, camera(focal, fstop, depth), lights)
}

/// Every image of the sheet: the thin lens of the bottle at f/2 and f/8 and of a 50 mm chart;
/// then for each lens the bottle wide open and at f/8 (when its iris closes that far), the points
/// wide open and through the thin lens at that f-number, and its chart wide open.
pub fn cells(size: (u32, u32)) -> Result<Vec<LensCell>, String> {
    let none = [FilterParams::default(); 3];
    let bottle = |fstop: f32| {
        let mut s = filter_bottle(size, none);
        s.camera.lens = None;
        s.camera.fstop = fstop;
        s
    };
    let thin = |key: &str, scene_name: &'static str, fstop: f32, scene: Scene| LensCell {
        key: key.into(),
        lens: String::new(),
        scene_name,
        traced: false,
        fstop,
        scene,
    };
    let mut out = vec![
        thin("thin--bottle--f2", "bottle", 2.0, bottle(2.0)),
        thin(
            "thin--bottle--f8",
            "bottle",
            CLOSED_FSTOP,
            bottle(CLOSED_FSTOP),
        ),
        thin(
            "thin--chart--f8",
            "chart",
            CLOSED_FSTOP,
            chart(size, CHART_FOCAL_NORMAL, CLOSED_FSTOP),
        ),
    ];
    for lens in catalogue() {
        let name = lens.key.replace('_', "-");
        let cell =
            |suffix: &str, scene_name: &'static str, traced: bool, fstop: f32, scene| LensCell {
                key: format!("{name}--{suffix}"),
                lens: lens.key.clone(),
                scene_name,
                traced,
                fstop,
                scene,
            };
        out.push(cell(
            "bottle--open",
            "bottle",
            true,
            0.0,
            with_lens(bottle(0.0), &lens, 0.0)?,
        ));
        if lens.f_number_max.is_none_or(|m| m >= CLOSED_FSTOP) {
            out.push(cell(
                "bottle--f8",
                "bottle",
                true,
                CLOSED_FSTOP,
                with_lens(bottle(CLOSED_FSTOP), &lens, CLOSED_FSTOP)?,
            ));
        }
        let points = with_lens(bokeh_points(size, 0.0), &lens, 0.0)?;
        let open = traced_fstop(&points);
        out.push(cell("points--open", "points", true, 0.0, points));
        out.push(cell(
            "points--thin",
            "points",
            false,
            open,
            bokeh_points(size, open),
        ));
        let focal = chart_focal(&lens, size);
        out.push(cell(
            "chart--open",
            "chart",
            true,
            0.0,
            with_lens(chart(size, focal, 0.0), &lens, 0.0)?,
        ));
    }
    Ok(out)
}

/// Renders the sheet into `dir`: one PNG per cell and `index.json` (key, lens, scene, traced,
/// f-number, focal length, samples, rays, seconds and the engine's lens information). With `only`,
/// just those cells (and the ones `index.json` does not hold yet); the other lines stay.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    threads: usize,
    only: &[String],
) -> Result<usize, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("index.json");
    let earlier = std::fs::read_to_string(&path).unwrap_or_default();
    let line_of = |key: &str| {
        earlier
            .lines()
            .find(|l| l.starts_with(&format!("{{\"key\":\"{key}\"")))
            .map(|l| l.trim_end_matches(',').to_string())
    };
    let mut json = Vec::new();
    let mut rendered = 0;
    for cell in cells(size)? {
        if !only.is_empty() && !only.contains(&cell.key) {
            if let Some(line) = line_of(&cell.key) {
                json.push(line);
                continue;
            }
        }
        rendered += 1;
        let out = render_progressive(&cell.scene, samples, threads, None);
        let rgb8 = out.to_rgb8(&cell.scene);
        let png = dir.join(format!("{}.png", cell.key));
        crate::write_png(&png, size.0, size.1, &rgb8)
            .map_err(|e| format!("{}: {e}", png.display()))?;
        json.push(format!(
            "{{\"key\":\"{}\",\"file\":\"{}.png\",\"lens\":\"{}\",\"scene\":\"{}\",\"traced\":{},\"fstop\":{},\"focalMm\":{},\"samples\":{},\"rays\":{},\"seconds\":{:.2},\"info\":{}}}",
            cell.key,
            cell.key,
            cell.lens,
            cell.scene_name,
            cell.traced,
            if cell.traced { traced_fstop(&cell.scene) } else { cell.fstop },
            cell.scene.camera.focal_mm,
            out.samples,
            out.rays,
            out.elapsed.as_secs_f64(),
            cell.scene.camera.lens_info_json()
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

/// Size and samples of the cost measurement: the O2 example at a quarter of its size, at the
/// 1024 samples of the brief.
pub const COST_SIZE: (u32, u32) = (64, 48);
/// See [`COST_SIZE`].
pub const COST_SAMPLES: u32 = 1024;

/// The time of `samples` camera samples of every pixel of `scene` on this thread, seconds: what
/// the renderer's tiles do before tracing a ray into the scene.
pub fn camera_seconds(scene: &Scene, samples: u32) -> f64 {
    let (w, h) = (scene.render.width, scene.render.height);
    let start = Instant::now();
    let mut sum = 0.0f32;
    for y in 0..h {
        for x in 0..w {
            for i in 0..samples {
                let sampler = PixelSampler::new(scene.render.seed, x, y, i);
                let (ray, _, weight) =
                    rt_core::render::camera_sample_weighted(scene, &sampler, x, y);
                sum += ray.dir.x + weight.r;
            }
        }
    }
    let seconds = start.elapsed().as_secs_f64();
    std::hint::black_box(sum);
    seconds
}

/// Measures what the traced camera costs (`rt --lens-cost <dir>`, `<dir>/cost.json`): the O2
/// example (the example at f/2.8 through the double Gauss) and the same through the thin lens,
/// rendered at `size` and `samples` on one thread, and their camera samples alone; the same for
/// the perfume bottle of the sheet (glass: a scene that costs more per sample) at a quarter of the
/// samples; then the camera samples of every lens of the catalogue in the points scene of the
/// sheet, per sample, against the thin lens's.
pub fn cost(dir: &Path, samples: u32, size: (u32, u32)) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let catalogue = catalogue();
    let double_gauss = catalogue
        .iter()
        .find(|l| l.key == "double_gauss_normal")
        .ok_or("no double Gauss in the catalogue")?;
    let mut example = rt_core::example::o2_scene();
    example.render.width = size.0;
    example.render.height = size.1;
    let mut bottle = filter_bottle(
        (size.0 * 3 / 2, size.1 * 3 / 2),
        [FilterParams::default(); 3],
    );
    bottle.camera.lens = None;
    let bottle_traced = with_lens(bottle.clone(), double_gauss, 2.8)?;
    bottle.camera.fstop = 2.8;
    let mut thin_example = example.clone();
    thin_example.camera.lens = None;
    let mut rows = Vec::new();
    for (scene_name, camera_name, scene, spp) in [
        ("example", "double_gauss", &example, samples),
        ("example", "thin", &thin_example, samples),
        ("bottle", "double_gauss", &bottle_traced, samples / 4),
        ("bottle", "thin", &bottle, samples / 4),
    ] {
        let render = render_progressive(scene, spp, 1, None);
        let camera = camera_seconds(scene, spp);
        let total = render.elapsed.as_secs_f64();
        let n = f64::from(scene.render.width) * f64::from(scene.render.height) * f64::from(spp);
        println!(
            "{scene_name}, {camera_name}: render {total:.1} s, camera {camera:.1} s ({:.1} %), {:.3} µs a camera sample, {:.3} µs a sample",
            100.0 * camera / total,
            1.0e6 * camera / n,
            1.0e6 * total / n
        );
        rows.push(format!(
            "{{\"scene\":\"{scene_name}\",\"camera\":\"{camera_name}\",\"width\":{},\"height\":{},\"samples\":{spp},\"renderSeconds\":{total:.3},\"cameraSeconds\":{camera:.3},\"share\":{:.4},\"cameraMicros\":{:.4},\"sampleMicros\":{:.4},\"rays\":{}}}",
            scene.render.width,
            scene.render.height,
            camera / total,
            1.0e6 * camera / n,
            1.0e6 * total / n,
            render.rays
        ));
    }
    let mut lenses = Vec::new();
    let per = 64;
    let points = bokeh_points((96, 72), 0.0);
    let m = 96.0 * 72.0 * f64::from(per);
    let thin_points = bokeh_points((96, 72), 2.0);
    let thin_micros = 1.0e6 * camera_seconds(&thin_points, per) / m;
    for lens in &catalogue {
        let scene = with_lens(points.clone(), lens, 0.0)?;
        let micros = 1.0e6 * camera_seconds(&scene, per) / m;
        let surfaces = lens.prescription.surfaces.len();
        println!(
            "{}: {micros:.3} µs a camera sample ({surfaces} surfaces)",
            lens.key
        );
        lenses.push(format!(
            "{{\"lens\":\"{}\",\"surfaces\":{surfaces},\"cameraMicros\":{micros:.4}}}",
            lens.key
        ));
    }
    let json = format!(
        "{{\"threads\":1,\"rows\":[\n{}\n],\"thinMicros\":{thin_micros:.4},\"lenses\":[\n{}\n]}}\n",
        rows.join(",\n"),
        lenses.join(",\n")
    );
    let path = dir.join("cost.json");
    std::fs::write(&path, &json).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_has_every_lens_on_the_bottle_the_points_and_its_chart_with_the_thin_lens() {
        let cells = cells((40, 30)).unwrap();
        // Three thin references, and per lens five cells but the mirror lens's f/8 (its one stop
        // is f/6.3).
        assert_eq!(cells.len(), 3 + 16 * 5 - 1);
        for lens in catalogue() {
            let of = |scene: &str, traced: bool| {
                cells
                    .iter()
                    .filter(|c| c.lens == lens.key && c.scene_name == scene && c.traced == traced)
                    .count()
            };
            let bottles = if lens.key == "catadioptric_mirror" {
                1
            } else {
                2
            };
            assert_eq!(
                (of("bottle", true), of("points", true), of("points", false)),
                (bottles, 1, 1),
                "{}",
                lens.key
            );
            assert_eq!(of("chart", true), 1, "{}", lens.key);
        }
        for c in &cells {
            let json = c.scene.camera.lens_info_json();
            // Every traced cell prepared its lens (the engine's numbers are there to show), and
            // the thin comparison of the points works at the lens's own f-number.
            assert_eq!(json.starts_with("{\"traced\":true"), c.traced, "{}", c.key);
            if c.scene_name == "points" && !c.traced {
                let twin = cells
                    .iter()
                    .find(|t| t.lens == c.lens && t.scene_name == "points" && t.traced)
                    .unwrap();
                assert_eq!(c.scene.camera.fstop, traced_fstop(&twin.scene), "{}", c.key);
                assert!(c.scene.camera.fstop > 0.0, "{}", c.key);
            }
        }
    }

    #[test]
    fn a_chart_is_framed_by_the_field_its_source_states() {
        let lenses = catalogue();
        let by = |key: &str| lenses.iter().find(|l| l.key == key).unwrap();
        let size = LENS_SHEET_SIZE;
        // 65° across the 45 mm diagonal of a 36 × 27 frame: 22.5 / tan 32.5°.
        assert_eq!(chart_focal(by("inverted_telephoto_wide"), size), 35.3);
        assert_eq!(chart_focal(by("fisheye_180"), size), CHART_FOCAL_FISHEYE);
        assert_eq!(
            chart_focal(by("telephoto_internal_focus"), size),
            CHART_FOCAL_TELE
        );
        assert_eq!(chart_focal(by("triplet"), size), CHART_FOCAL_NORMAL);
        // The chart's lights fill the frame of a lens without distortion, inside it by a margin.
        let s = chart(size, 50.0, 8.0);
        assert_eq!(s.lights.len(), CHART_GRID.0 * CHART_GRID.1);
        let (sw, _) = frame(size, 36.0);
        let edge = s.lights.iter().map(|l| l.position.x).fold(0.0f32, f32::max);
        let on_sensor = edge / CHART_DISTANCE_MM * 50.0;
        assert!(
            on_sensor < sw / 2.0 && on_sensor > 0.95 * sw / 2.0,
            "{on_sensor}"
        );
    }
}

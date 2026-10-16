//! The sheet of the traced lenses (O2, `rt --lens-sheet <dir>`; `tools/lens-sheet.mjs` writes its
//! page): the perfume bottle of the filter sheet through each of the 16 lenses of the catalogue
//! (the anamorphic adapter in front of the double Gauss) wide open and at f/8, and a scene of
//! points of light far behind the focus, on black, through each of them wide open, where cat's
//! eye, bubble, creamy blur and swirl show; with the thin lens of the same camera for comparison.

use crate::filter_sheet::filter_bottle;
use crate::lens_catalogue::{catalogue, CatalogueLens};
use crate::render_progressive;
use rt_core::color::Rgb;
use rt_core::math::Vec3;
use rt_core::optics::filters::FilterParams;
use rt_core::scene::{
    Camera, EnvKind, Environment, Floor, FloorMode, Geometry, Lens, LensParams, Light, LightKind,
    RenderSettings, Scene, LIGHT_FLAG_CAMERA,
};
use std::path::Path;

/// Size and samples of the sheet.
pub const LENS_SHEET_SIZE: (u32, u32) = (400, 300);
/// See [`LENS_SHEET_SIZE`].
pub const LENS_SHEET_SAMPLES: u32 = 96;
/// The stop of the second row of the bottle.
pub const CLOSED_FSTOP: f32 = 8.0;

/// One image of the sheet.
pub struct LensCell {
    /// File name without the extension.
    pub key: String,
    /// The lens (catalogue key; empty: the thin lens).
    pub lens: String,
    /// `bottle` or `points`.
    pub scene_name: &'static str,
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

/// Points of light far behind the focus on black: an 85 mm focused at 600 mm, small discs 6 m
/// away in a 5 × 4 grid over the frame, seen by camera rays only (the thin lens of the camera at
/// `fstop`, or what a traced lens makes of it).
pub fn bokeh_points(size: (u32, u32), fstop: f32) -> Scene {
    let (focal, sensor, focus, depth, diameter) = (85.0f32, 36.0f32, 600.0f32, 6000.0f32, 60.0f32);
    let camera = Camera {
        position: Vec3::ZERO,
        target: Vec3::new(0.0, 1000.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        focal_mm: focal,
        sensor_mm: sensor,
        fstop,
        focus_dist: focus,
        ortho: false,
        ortho_width: 1000.0,
        lens: None,
    };
    let aspect = size.0 as f32 / size.1 as f32;
    let (sw, sh) = if aspect >= 1.0 {
        (sensor, sensor / aspect)
    } else {
        (sensor * aspect, sensor)
    };
    // As bright as the bokeh thumbnails' (tools/bokeh-scene.mjs): a blur disc of an f/2 averages
    // about 0.45 before the tone curve.
    let blur = (focal / 2.0) * (depth - focus) / depth / focus;
    let radiance = 0.45 * (blur / (diameter / depth)).powi(2);
    let area_m2 = std::f32::consts::PI * (diameter / 2000.0).powi(2);
    let mut lights = Vec::new();
    for gx in [-0.8f32, -0.4, 0.0, 0.4, 0.8] {
        for gy in [-0.72f32, -0.24, 0.24, 0.72] {
            let x = gx * sw / 2.0 * depth / focal;
            let z = gy * sh / 2.0 * depth / focal;
            let position = Vec3::new(x, depth, z);
            lights.push(Light {
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
            });
        }
    }
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

/// Every image of the sheet: the thin lens of the bottle at f/2 and f/8 and of the points at f/2,
/// then each lens on the bottle wide open and at f/8, and on the points wide open.
pub fn cells(size: (u32, u32)) -> Result<Vec<LensCell>, String> {
    let none = [FilterParams::default(); 3];
    let bottle = |fstop: f32| {
        let mut s = filter_bottle(size, none);
        s.camera.lens = None;
        s.camera.fstop = fstop;
        s
    };
    let mut out = vec![
        LensCell {
            key: "thin--bottle--f2".into(),
            lens: String::new(),
            scene_name: "bottle",
            fstop: 2.0,
            scene: bottle(2.0),
        },
        LensCell {
            key: "thin--bottle--f8".into(),
            lens: String::new(),
            scene_name: "bottle",
            fstop: CLOSED_FSTOP,
            scene: bottle(CLOSED_FSTOP),
        },
        LensCell {
            key: "thin--points--f2".into(),
            lens: String::new(),
            scene_name: "points",
            fstop: 2.0,
            scene: bokeh_points(size, 2.0),
        },
    ];
    for lens in catalogue() {
        let name = lens.key.replace('_', "-");
        out.push(LensCell {
            key: format!("{name}--bottle--open"),
            lens: lens.key.clone(),
            scene_name: "bottle",
            fstop: 0.0,
            scene: with_lens(bottle(0.0), &lens, 0.0)?,
        });
        out.push(LensCell {
            key: format!("{name}--bottle--f8"),
            lens: lens.key.clone(),
            scene_name: "bottle",
            fstop: CLOSED_FSTOP,
            scene: with_lens(bottle(CLOSED_FSTOP), &lens, CLOSED_FSTOP)?,
        });
        out.push(LensCell {
            key: format!("{name}--points--open"),
            lens: lens.key.clone(),
            scene_name: "points",
            fstop: 0.0,
            scene: with_lens(bokeh_points(size, 0.0), &lens, 0.0)?,
        });
    }
    Ok(out)
}

/// Renders the sheet into `dir`: one PNG per cell and `index.json` (key, lens, scene, f-number,
/// samples, rays, seconds and the engine's lens information). With `only`, just those cells; the
/// other lines of an existing `index.json` stay.
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
            "{{\"key\":\"{}\",\"file\":\"{}.png\",\"lens\":\"{}\",\"scene\":\"{}\",\"fstop\":{},\"samples\":{},\"rays\":{},\"seconds\":{:.2},\"info\":{}}}",
            cell.key,
            cell.key,
            cell.lens,
            cell.scene_name,
            cell.fstop,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_has_every_lens_on_the_bottle_twice_and_on_the_points_with_the_thin_lens() {
        let cells = cells((40, 30)).unwrap();
        assert_eq!(cells.len(), 3 + 16 * 3);
        for lens in catalogue() {
            let of = |scene: &str| {
                cells
                    .iter()
                    .filter(|c| c.lens == lens.key && c.scene_name == scene)
                    .count()
            };
            assert_eq!((of("bottle"), of("points")), (2, 1), "{}", lens.key);
        }
        // Every traced cell prepared its lens (the engine's numbers are there to show).
        for c in cells.iter().filter(|c| !c.lens.is_empty()) {
            assert!(
                c.scene
                    .camera
                    .lens_info_json()
                    .starts_with("{\"traced\":true"),
                "{}",
                c.key
            );
        }
    }
}

#[cfg(test)]
mod probe {
    use super::*;
    use rt_core::optics::traced::Traced;
    #[test]
    fn probe_adapter() {
        for key in ["double_gauss_normal", "anamorphic_adapter_2x"] {
            let lens = catalogue().into_iter().find(|l| l.key == key).unwrap();
            let s = with_lens(bokeh_points((400, 300), 0.0), &lens, 0.0).unwrap();
            let t = s.camera.lens.as_ref().unwrap().traced().unwrap();
            for (x, y) in [(5.0f32, 0.0f32), (0.0, 5.0)] {
                if let Traced::Out { origin, dir } = t.chief(x, y, (0.0, 0.0)) {
                    eprintln!("{key} film ({x},{y}): dir ({:.4},{:.4},{:.4}) tanx {:.4} tany {:.4} origin {:?}", dir.x, dir.y, dir.z, dir.x / dir.z, dir.y / dir.z, origin);
                }
            }
            // On-axis pupil extent at the front: sample the rear plane rays
            let (mut xmin, mut xmax, mut ymin, mut ymax) = (1e9f32, -1e9f32, 1e9f32, -1e9f32);
            for i in 0..64 {
                for j in 0..64 {
                    let p = (
                        2.0 * (i as f32 + 0.5) / 64.0 - 1.0,
                        2.0 * (j as f32 + 0.5) / 64.0 - 1.0,
                    );
                    if let Traced::Out { origin, .. } = t.chief(0.0, 0.0, p) {
                        xmin = xmin.min(origin.x);
                        xmax = xmax.max(origin.x);
                        ymin = ymin.min(origin.y);
                        ymax = ymax.max(origin.y);
                    }
                }
            }
            eprintln!(
                "{key} front extent x [{xmin:.2},{xmax:.2}] y [{ymin:.2},{ymax:.2}] info {}",
                s.camera
                    .lens_info_json()
                    .chars()
                    .take(200)
                    .collect::<String>()
            );
        }
    }
}

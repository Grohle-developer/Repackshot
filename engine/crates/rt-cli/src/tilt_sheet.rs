//! The sheet of the tilted lens (O4, `rt --tilt-sheet <dir>`): points of light laid out on a
//! floor that runs away from a camera looking down at it, seen through the simple lens and through
//! the traced double Gauss, upright and tilted so that the plane of sharp focus is the floor.
//!
//! A 50 mm at f/2, 400 mm above the floor and looking down until its axis meets the floor 1.2 m
//! away (the focus distance). Upright, the plane of sharp focus is square to the view and only
//! the lights near 1.5 m are sharp; the tilt that lays it on the floor (the hinge rule of the
//! simple lens, `sin α = f cos β / h` for a camera `h` above the floor looking down by `β`) makes
//! every light on the floor sharp, near and far, with either lens. The four images and a 2 × 2
//! composite of them (upright on the left, tilted on the right; the simple lens above, the traced
//! lens below) go to the directory, with `index.json`.

use crate::lens_catalogue::catalogue;
use crate::lens_sheet::{camera, disc, lights_scene};
use crate::render_progressive;
use rt_core::math::Vec3;
use rt_core::scene::{Lens, LensParams, Scene};
use std::path::Path;

/// Size and samples of each image.
pub const TILT_SHEET_SIZE: (u32, u32) = (480, 320);
/// See [`TILT_SHEET_SIZE`].
pub const TILT_SHEET_SAMPLES: u32 = 128;
/// The camera's height above the floor, mm.
pub const HEIGHT_MM: f32 = 400.0;
/// Where the axis meets the floor, mm from the camera: the focus distance.
pub const FOCUS_MM: f32 = 1200.0;
/// Focal length and f-number.
pub const FOCAL_MM: f32 = 50.0;
/// See [`FOCAL_MM`].
pub const FSTOP: f32 = 2.0;

/// The tilt that lays the plane of sharp focus on the floor, degrees (about the horizontal axis).
pub fn floor_tilt_deg() -> f32 {
    let sin_b = HEIGHT_MM / FOCUS_MM;
    let cos_b = (1.0 - sin_b * sin_b).sqrt();
    (FOCAL_MM * cos_b / HEIGHT_MM).asin().to_degrees()
}

/// Small lights on the floor: five columns, twelve rows from 0.65 m to 3.8 m along the view.
fn floor_scene(size: (u32, u32)) -> Scene {
    let sin_b = HEIGHT_MM / FOCUS_MM;
    let cos_b = (1.0 - sin_b * sin_b).sqrt();
    let mut cam = camera(FOCAL_MM, FSTOP, FOCUS_MM);
    cam.target = Vec3::new(0.0, cos_b * 1000.0, -sin_b * 1000.0);
    let mut lights = Vec::new();
    for row in 0..12 {
        let y = 650.0 * (3800.0f32 / 650.0).powf(row as f32 / 11.0);
        for col in -2..=2 {
            let x = col as f32 * 0.12 * y;
            lights.push(disc(Vec3::new(x, y, -HEIGHT_MM), 4.0 + 0.002 * y, 12.0));
        }
    }
    lights_scene(size, cam, lights)
}

/// The four cells: `simple-upright`, `simple-tilted`, `traced-upright`, `traced-tilted`.
pub fn cells(size: (u32, u32)) -> Result<Vec<(String, Scene)>, String> {
    let dg = catalogue()
        .into_iter()
        .find(|l| l.key == "double_gauss_normal")
        .ok_or("the double Gauss is missing from the catalogue")?;
    let mut out = Vec::new();
    for traced in [false, true] {
        for tilt in [0.0, floor_tilt_deg()] {
            let mut scene = floor_scene(size);
            let params = LensParams {
                tilt_deg: tilt,
                prescription: traced.then(|| dg.prescription.clone()),
                ..LensParams::default()
            };
            scene.camera.lens = Some(Lens::new(params).map_err(|e| e.to_string())?);
            scene.camera.prepare_lens().map_err(|e| e.to_string())?;
            let key = format!(
                "{}-{}",
                if traced { "traced" } else { "simple" },
                if tilt == 0.0 { "upright" } else { "tilted" }
            );
            out.push((key, scene));
        }
    }
    Ok(out)
}

/// Renders the sheet into `dir`: the four PNGs, `composite.png` and `index.json`.
pub fn run(dir: &Path, size: (u32, u32), samples: u32, threads: usize) -> Result<usize, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let gap = 4u32;
    let (cw, ch) = (2 * size.0 + gap, 2 * size.1 + gap);
    let mut composite = vec![48u8; (cw * ch * 3) as usize];
    let mut json = Vec::new();
    for (i, (key, scene)) in cells(size)?.into_iter().enumerate() {
        let out = render_progressive(&scene, samples, threads, None);
        let rgb8 = out.to_rgb8(&scene);
        let png = dir.join(format!("{key}.png"));
        crate::write_png(&png, size.0, size.1, &rgb8)
            .map_err(|e| format!("{}: {e}", png.display()))?;
        let (ox, oy) = (
            (i as u32 % 2) * (size.0 + gap),
            (i as u32 / 2) * (size.1 + gap),
        );
        for y in 0..size.1 {
            let src = (y * size.0 * 3) as usize;
            let dst = (((oy + y) * cw + ox) * 3) as usize;
            composite[dst..dst + (size.0 * 3) as usize]
                .copy_from_slice(&rgb8[src..src + (size.0 * 3) as usize]);
        }
        json.push(format!(
            "{{\"key\":\"{key}\",\"file\":\"{key}.png\",\"samples\":{},\"seconds\":{:.2},\"info\":{}}}",
            out.samples,
            out.elapsed.as_secs_f64(),
            scene.camera.lens_info_json()
        ));
        println!("{key}: {:.1} s", out.elapsed.as_secs_f64());
    }
    let png = dir.join("composite.png");
    crate::write_png(&png, cw, ch, &composite).map_err(|e| format!("{}: {e}", png.display()))?;
    let index = format!(
        "{{\"width\":{},\"height\":{},\"focalMm\":{FOCAL_MM},\"fstop\":{FSTOP},\"heightMm\":{HEIGHT_MM},\"focusMm\":{FOCUS_MM},\"tiltDeg\":{:.3},\"cells\":[\n{}\n]}}\n",
        size.0,
        size.1,
        floor_tilt_deg(),
        json.join(",\n")
    );
    let path = dir.join("index.json");
    std::fs::write(&path, index).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_floor_tilt_lays_the_simple_lens_plane_on_the_floor() {
        // The hinge rule's normal `f·forward + u·sin α·b` is the floor's: square to it.
        let sin_b = HEIGHT_MM / FOCUS_MM;
        let cos_b = (1.0 - sin_b * sin_b).sqrt();
        let forward = Vec3::new(0.0, cos_b, -sin_b);
        let right = Vec3::new(1.0, 0.0, 0.0);
        let b = forward.cross(right);
        let n =
            (forward * FOCAL_MM + b * (FOCUS_MM * floor_tilt_deg().to_radians().sin())).normalize();
        assert!(n.x.abs() < 1e-6 && n.y.abs() < 1e-5, "{n:?}");
        assert!(floor_tilt_deg() > 0.0 && floor_tilt_deg() < 12.0);
        assert_eq!(cells((32, 24)).unwrap().len(), 4);
    }
}

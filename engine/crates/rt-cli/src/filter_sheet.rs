//! The sheet of the effect filters (O3a, `rt --filter-sheet <dir>`; `tools/lens-filters-sheet.mjs`
//! writes its page): the perfume bottle with a small spot behind it in the frame and another one
//! outside it, through every filter at the grades 1/4, 1 and 2, two stacks, no filter, and three
//! filters without their connections to the lights (the scattering alone), for comparison.

use crate::render_progressive;
use crate::scenes::glass_bottle;
use rt_core::color::Rgb;
use rt_core::math::Vec3;
use rt_core::optics::filters::*;
use rt_core::scene::{
    Lens, LensParams, Light, LightKind, Scene, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY,
};
use std::path::Path;

/// Size and samples of the sheet (the brief: 512 px wide, 128 spp).
pub const FILTER_SHEET_SIZE: (u32, u32) = (512, 384);
/// See [`FILTER_SHEET_SIZE`].
pub const FILTER_SHEET_SAMPLES: u32 = 128;

/// The kinds of the sheet, in the order of `src/data/lens-filters.ts`, with their file names.
pub const KINDS: [(u32, &str); 8] = [
    (FILTER_DIFFUSION_WHITE, "diffusion-white"),
    (FILTER_DIFFUSION_BLACK, "diffusion-black"),
    (FILTER_DIFFUSION_GOLD, "diffusion-gold"),
    (FILTER_GLIMMER, "glimmer"),
    (FILTER_SOFT, "soft"),
    (FILTER_NET, "net"),
    (FILTER_STAR, "star"),
    (FILTER_STREAK, "streak"),
];

/// The grades of the sheet.
pub const SHEET_GRADES: [(f32, &str); 3] = [(0.25, "1-4"), (1.0, "1"), (2.0, "2")];

/// One image of the sheet.
pub struct FilterCell {
    /// File name without the extension.
    pub key: String,
    /// The filters, as `kind:grade` (empty: none).
    pub stack: Vec<(u32, f32)>,
    /// The scene.
    pub scene: Scene,
    /// Whether the filters connect to the lights (the comparison cells render the scattering
    /// alone).
    pub connect: bool,
}

/// The bottle of the sheet: [`glass_bottle`] without its backlit panel, on a darker dome, with a
/// small bright spot behind the bottle in the frame (backlight) and another one above the frame,
/// both seen by the camera, through `filters`.
pub fn filter_bottle(size: (u32, u32), filters: [FilterParams; 3]) -> Scene {
    let mut scene = glass_bottle(size);
    scene.lights.truncate(2);
    scene.environment.strength = 0.25;
    let disk = |position: Vec3, diameter: f32, power: f32| Light {
        kind: LightKind::Disk,
        position,
        direction: (scene.camera.position - position).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: diameter,
        size_y: diameter,
        color: Rgb::new(1.0, 0.96, 0.9),
        power,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_CAMERA | LIGHT_FLAG_GLOSSY,
    };
    // In the frame, behind the bottle and to its right (about 4° right and 2° up); just above the
    // frame (13° up, the frame reaching 9°), out of it.
    let (forward, right, up) = scene.camera.basis();
    let at = |f: f32, r: f32, u: f32| scene.camera.position + forward * f + right * r + up * u;
    let inside = disk(at(940.0, 70.0, 40.0), 12.0, 0.6);
    let outside = disk(at(700.0, -90.0, 161.0), 20.0, 1.5);
    scene.lights.push(inside);
    scene.lights.push(outside);
    scene.camera.lens = Some(
        Lens::new(LensParams {
            filters,
            ..LensParams::default()
        })
        .unwrap_or_else(|e| panic!("the sheet's filters are valid: {e}")),
    );
    scene
}

fn one(kind: u32, grade: f32) -> FilterParams {
    FilterParams {
        kind,
        grade,
        points: if kind == FILTER_STAR { 6 } else { 0 },
        ..FilterParams::default()
    }
}

/// Every image of the sheet.
pub fn cells(size: (u32, u32)) -> Vec<FilterCell> {
    let none = FilterParams::default();
    let mut out = vec![FilterCell {
        key: "none".into(),
        stack: Vec::new(),
        scene: filter_bottle(size, [none; 3]),
        connect: true,
    }];
    for (kind, name) in KINDS {
        for (grade, g) in SHEET_GRADES {
            out.push(FilterCell {
                key: format!("{name}--{g}"),
                stack: vec![(kind, grade)],
                scene: filter_bottle(size, [one(kind, grade), none, none]),
                connect: true,
            });
        }
    }
    let stacks = [
        (
            "stack--black-1-2--star-6",
            [
                one(FILTER_DIFFUSION_BLACK, 0.5),
                one(FILTER_STAR, 1.0),
                none,
            ],
        ),
        (
            "stack--gold-1--streak",
            [
                one(FILTER_DIFFUSION_GOLD, 1.0),
                one(FILTER_STREAK, 1.0),
                none,
            ],
        ),
    ];
    for (key, filters) in stacks {
        out.push(FilterCell {
            key: key.into(),
            stack: filters
                .iter()
                .filter(|f| f.kind != FILTER_NONE)
                .map(|f| (f.kind, f.grade))
                .collect(),
            scene: filter_bottle(size, filters),
            connect: true,
        });
    }
    // The comparison: the scattering alone, without the connections to the lights.
    for (kind, grade, key) in [
        (FILTER_STAR, 1.0, "star--1--alone"),
        (FILTER_DIFFUSION_BLACK, 2.0, "diffusion-black--2--alone"),
        (FILTER_GLIMMER, 1.0, "glimmer--1--alone"),
    ] {
        out.push(FilterCell {
            key: key.into(),
            stack: vec![(kind, grade)],
            scene: filter_bottle(size, [one(kind, grade), none, none]),
            connect: false,
        });
    }
    out
}

/// Renders the sheet into `dir`: one PNG per cell and `index.json` (key, stack, samples, rays,
/// seconds). With `only`, just those cells; the other lines of an existing `index.json` stay.
pub fn run(
    dir: &Path,
    size: (u32, u32),
    samples: u32,
    threads: usize,
    only: &[String],
) -> Result<usize, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("index.json");
    // The cells of an earlier index, one per line, by key.
    let earlier = std::fs::read_to_string(&path).unwrap_or_default();
    let line_of = |key: &str| {
        earlier
            .lines()
            .find(|l| l.starts_with(&format!("{{\"key\":\"{key}\"")))
            .map(|l| l.trim_end_matches(',').to_string())
    };
    let mut json = Vec::new();
    let all = cells(size);
    let mut rendered = 0;
    for cell in &all {
        if !only.is_empty() && !only.contains(&cell.key) {
            if let Some(line) = line_of(&cell.key) {
                json.push(line);
                continue;
            }
        }
        rendered += 1;
        let mut scene = cell.scene.clone();
        let lens = scene
            .camera
            .lens
            .take()
            .map(|l| l.with_connections(cell.connect));
        scene.camera.lens = lens;
        let out = render_progressive(&scene, samples, threads, None);
        let rgb8 = out.to_rgb8(&cell.scene);
        let path = dir.join(format!("{}.png", cell.key));
        crate::write_png(&path, size.0, size.1, &rgb8)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        let stack: Vec<String> = cell
            .stack
            .iter()
            .map(|(k, g)| format!("{{\"kind\":{k},\"grade\":{g}}}"))
            .collect();
        json.push(format!(
            "{{\"key\":\"{}\",\"file\":\"{}.png\",\"stack\":[{}],\"connect\":{},\"samples\":{},\"rays\":{},\"seconds\":{:.2}}}",
            cell.key,
            cell.key,
            stack.join(","),
            cell.connect,
            out.samples,
            out.rays,
            out.elapsed.as_secs_f64()
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
    fn the_sheet_has_every_kind_at_three_grades_two_stacks_and_none() {
        let cells = cells((32, 24));
        assert_eq!(cells.len(), 1 + 8 * 3 + 2 + 3);
        for (kind, _) in KINDS {
            assert_eq!(
                cells
                    .iter()
                    .filter(|c| c.connect && c.stack == [(kind, 1.0)])
                    .count(),
                1
            );
        }
        // The spot in the frame is in the frame, the other one is not.
        let scene = &cells[0].scene;
        let (forward, right, up) = scene.camera.basis();
        let half_w = 0.5 * scene.camera.sensor_mm / scene.camera.focal_mm;
        let seen = |p: Vec3| {
            let d = p - scene.camera.position;
            let z = d.dot(forward);
            (d.dot(right) / z).abs() < half_w && (d.dot(up) / z).abs() < half_w * 0.75
        };
        let n = scene.lights.len();
        assert!(seen(scene.lights[n - 2].position));
        assert!(!seen(scene.lights[n - 1].position));
    }
}

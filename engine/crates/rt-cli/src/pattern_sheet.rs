//! `rt --pattern-sheet <dir> --materials <patterns.rsb>`: the woods and the cloths of the
//! catalogue as spheres rendered by the engine (E6), each **before** (the flat colour the engine
//! drew until E6: `0.6 light + 0.4 dark` for wood, the mean of the two threads for cloth),
//! **after** (the procedural pattern) and a **close-up** of the after (four times the focal
//! length), then the same three of a 60 × 40 × 25 mm box (the flat-sawn arches of its faces are
//! what people recognise as wood), into `<dir>/wood-sheet.html` and `<dir>/cloth-sheet.html` with
//! the images in `<dir>/patterns/`. When the materials hold `PINE`, the wood sheet ends with its
//! knots: 0, 2 and 6 of 15 mm and 6 of 30 mm, on the box's largest face seen straight on and on
//! a 300 × 100 × 20 mm board, at 512 px. The cloth sheet ends with every cloth up close (a
//! [`MACRO_MM`] field seen straight on, where its real threads show) and the alternatives of
//! [`ALTERNATIVES`].
//!
//! The materials are the interface's own: `tests/fixtures/patterns.rsb` is written by the
//! TypeScript RSB writer (`materialToRsb`, `patternToRsb`) from the presets of
//! `src/data/materials.ts` on a part of 100 mm (`REPACK_WRITE_FIXTURES=1 npx vitest run
//! tests/patterns.test.ts`; the same test fails when it is not current). Its `NAME` section
//! (ignored by every reader but this one) holds `KEY\tLabel` per material, in order.

use crate::render_progressive;
use rt_core::color::Rgb;
use rt_core::math::Vec3;
use rt_core::pattern::{Pattern, PATTERN_CLOTH, PATTERN_WOOD};
use rt_core::scene::{
    Camera, EnvKind, Environment, Geometry, Instance, Light, LightKind, Material, RenderSettings,
    Scene, Transform, BACKGROUND_COLOR, LIGHT_FLAG_GLOSSY,
};
use std::fmt::Write as _;
use std::path::Path;

/// Default image size of one sphere.
pub const SHEET_SIZE: (u32, u32) = (288, 288);
/// Default samples per pixel.
pub const SHEET_SAMPLES: u32 = 96;
/// Radius of the spheres (the fixture's part size is their diameter), millimetres.
pub const SPHERE_MM: f32 = 50.0;
/// The box: 60 × 40 × 25 mm.
pub const BOX_MM: (f32, f32, f32) = (60.0, 40.0, 25.0);
/// The board of the knot row: 300 × 100 × 20 mm.
pub const BOARD_MM: (f32, f32, f32) = (300.0, 100.0, 20.0);
/// The knot row: count and diameter (mm) of pine's knots.
pub const KNOT_ROW: [(u32, f32); 4] = [(0, 15.0), (2, 15.0), (6, 15.0), (6, 30.0)];
/// Width of the knot row's images (the box's are square, the board's a third as high).
pub const KNOT_WIDTH: u32 = 512;
/// Width of the field of a cloth's macro image, millimetres.
pub const MACRO_MM: f32 = 10.0;

/// One alternative of the cloth sheet: a catalogue key, what changes, and the change.
pub type Alternative = (&'static str, &'static str, fn(&mut Pattern));

/// The cloth sheet's alternatives: a catalogue key, what changes, and the change. Denim woven
/// as the 2/2 twill of the other twills (its own is a 3/1). (The first sheet also showed carbon
/// fibre with relief 0.05, which the lead chose: the catalogue sends it now.)
pub const ALTERNATIVES: [Alternative; 1] = [("DENIM", "Denim as a 2/2 twill", |p| p.variant = 1)];

/// The name of a cloth's weave (`Pattern::variant`).
pub fn weave_name(variant: u32) -> &'static str {
    match variant {
        1 => "twill 2/2",
        2 => "satin",
        3 => "canvas",
        4 => "knit",
        5 => "felt",
        6 => "twill 3/1",
        _ => "plain",
    }
}

/// What a sheet row says of a material under its name: a cloth's weave and density.
pub fn pattern_info(p: &Pattern) -> String {
    if p.kind == PATTERN_CLOTH {
        format!(
            "{} · {:.0}/cm ({:.2} mm)",
            weave_name(p.variant),
            10.0 / p.scale_mm.max(1.0e-6),
            p.scale_mm
        )
    } else {
        String::new()
    }
}

/// What a sheet image shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Object {
    /// The sphere of [`SPHERE_MM`].
    Sphere,
    /// The box of [`BOX_MM`].
    Box,
}

/// One material of the sheet.
#[derive(Clone, Debug, PartialEq)]
pub struct SheetMaterial {
    /// Catalogue key.
    pub key: String,
    /// English label.
    pub label: String,
    /// The material as the interface sends it.
    pub material: Material,
    /// Its pattern.
    pub pattern: Pattern,
}

impl SheetMaterial {
    /// The colour the engine drew before E6.
    pub fn flat_color(&self) -> Rgb {
        let (a, b) = (self.pattern.color_a, self.pattern.color_b);
        if self.pattern.kind == PATTERN_WOOD {
            a * 0.6 + b * 0.4
        } else {
            (a + b) * 0.5
        }
    }
}

/// Reads the materials, patterns and names of a sheet fixture.
pub fn read_materials(bytes: &[u8]) -> Result<Vec<SheetMaterial>, String> {
    let scene = Scene::from_rsb(bytes).map_err(|e| e.to_string())?;
    let names = name_section(bytes).ok_or("the fixture has no NAME section")?;
    if names.len() != scene.materials.len() {
        return Err(format!(
            "{} names for {} materials",
            names.len(),
            scene.materials.len()
        ));
    }
    let mut out = Vec::new();
    for (i, (material, name)) in scene.materials.iter().zip(names).enumerate() {
        let pattern = scene
            .patterns
            .iter()
            .find(|p| p.material == i as u32)
            .ok_or_else(|| format!("material {i} ({name}) has no pattern"))?;
        let (key, label) = name
            .split_once('\t')
            .unwrap_or((name.as_str(), name.as_str()));
        out.push(SheetMaterial {
            key: key.to_string(),
            label: label.to_string(),
            material: material.clone(),
            pattern: Pattern {
                material: 0,
                ..pattern.clone()
            },
        });
    }
    Ok(out)
}

/// The strings of the `NAME` section: `u32 count`, then per string `u32 byte_len` and its UTF-8
/// bytes padded to 4.
fn name_section(bytes: &[u8]) -> Option<Vec<String>> {
    let word = |at: usize| -> Option<u32> {
        let b = bytes.get(at..at + 4)?;
        Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let mut pos = 8 + word(4)? as usize;
    while pos + 8 <= bytes.len() {
        let tag = bytes.get(pos..pos + 4)?;
        let len = word(pos + 4)? as usize;
        if tag == b"NAME" {
            let payload = bytes.get(pos + 8..pos + 8 + len)?;
            let count = u32::from_le_bytes(payload.get(0..4)?.try_into().ok()?) as usize;
            let mut at = 4;
            let mut names = Vec::with_capacity(count);
            for _ in 0..count {
                let n = u32::from_le_bytes(payload.get(at..at + 4)?.try_into().ok()?) as usize;
                let text = std::str::from_utf8(payload.get(at + 4..at + 4 + n)?).ok()?;
                names.push(text.to_string());
                at += 4 + n.div_ceil(4) * 4;
            }
            return Some(names);
        }
        pos += 8 + len;
    }
    None
}

/// The sphere or the box with `material` (and `pattern`), under a soft key and a fill in a
/// studio dome over a dark background; `close` frames its middle at four times the focal length.
pub fn sphere_scene(
    material: &Material,
    pattern: Option<&Pattern>,
    size: (u32, u32),
    close: bool,
) -> Scene {
    sheet_scene(material, pattern, size, Object::Sphere, close)
}

/// [`sphere_scene`] for either object.
pub fn sheet_scene(
    material: &Material,
    pattern: Option<&Pattern>,
    size: (u32, u32),
    object: Object,
    close: bool,
) -> Scene {
    let target = Vec3::ZERO;
    let position = match object {
        Object::Sphere => Vec3::new(-60.0, -300.0, 110.0),
        Object::Box => Vec3::new(-150.0, -200.0, 170.0),
    };
    let key = Vec3::new(-260.0, -220.0, 300.0);
    let fill = Vec3::new(320.0, -160.0, 60.0);
    let panel = |at: Vec3, size: f32, power: f32| Light {
        kind: LightKind::Rect,
        position: at,
        direction: (target - at).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: size,
        size_y: size,
        power,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    Scene {
        camera: Camera {
            position,
            target,
            up: Vec3::new(0.0, 0.0, 1.0),
            focal_mm: match (object, close) {
                (_, true) => 340.0,
                (Object::Sphere, false) => 85.0,
                (Object::Box, false) => 105.0,
            },
            sensor_mm: 36.0,
            fstop: 0.0,
            focus_dist: (target - position).length(),
            ortho: false,
            ortho_width: 0.0,
            lens: None,
        },
        materials: vec![material.clone()],
        geometry: Geometry::new(
            vec![match object {
                Object::Sphere => rt_core::example::icosphere(target, SPHERE_MM, 5),
                Object::Box => {
                    let h = Vec3::new(BOX_MM.0, BOX_MM.1, BOX_MM.2) * 0.5;
                    rt_core::example::split_box(-h, h, &[0, 1, 2, 3, 4, 5])
                }
            }],
            vec![Instance::new(0, Transform::IDENTITY, 0)],
        )
        .unwrap_or_default(),
        lights: vec![panel(key, 220.0, 1.1), panel(fill, 300.0, 0.25)],
        environment: Environment {
            kind: EnvKind::Studio,
            floor: 0.02,
            horizon: 0.05,
            zenith: 0.1,
            strength: 1.0,
            background_color: Rgb::splat(0.035),
            background_mode: BACKGROUND_COLOR,
            ..Environment::default()
        },
        render: RenderSettings {
            width: size.0,
            height: size.1,
            max_samples: 0,
            seed: 3,
            tonemap: 1,
            ..RenderSettings::default()
        },
        patterns: pattern
            .map(|p| Pattern {
                material: 0,
                ..p.clone()
            })
            .into_iter()
            .collect(),
        ..Scene::default()
    }
}

/// A box of `dims` (mm, centred, its largest face up) with `material` and `pattern`, seen straight
/// from above by an orthographic camera a little wider than it, under the sheet's lights.
pub fn top_scene(
    material: &Material,
    pattern: &Pattern,
    size: (u32, u32),
    dims: (f32, f32, f32),
) -> Scene {
    let mut scene = sheet_scene(material, Some(pattern), size, Object::Box, false);
    let h = Vec3::new(dims.0, dims.1, dims.2) * 0.5;
    scene.geometry = Geometry::new(
        vec![rt_core::example::split_box(-h, h, &[0, 1, 2, 3, 4, 5])],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
    )
    .unwrap_or_default();
    let width = 1.08 * dims.0.max(dims.1 * size.0 as f32 / size.1.max(1) as f32);
    scene.camera = Camera {
        position: Vec3::new(0.0, 0.0, 400.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 1.0, 0.0),
        focal_mm: 50.0,
        sensor_mm: 36.0,
        fstop: 0.0,
        focus_dist: 400.0,
        ortho: true,
        ortho_width: width,
        lens: None,
    };
    scene
}

/// A [`MACRO_MM`] field of a large flat piece of `material`, seen straight from above by an
/// orthographic camera, under the sheet's lights (the key rakes it at about 40°).
pub fn macro_scene(material: &Material, pattern: &Pattern, size: (u32, u32)) -> Scene {
    let mut scene = top_scene(material, pattern, size, (60.0, 60.0, 10.0));
    scene.camera.ortho_width = MACRO_MM;
    scene
}

/// One image of the cloth sheet's macro rows.
#[derive(Clone, Debug, PartialEq)]
pub struct MacroImage {
    /// File, relative to the sheet.
    pub file: String,
    /// What it shows.
    pub caption: String,
}

/// Renders every cloth of `cloths` up close, then the [`ALTERNATIVES`] that `cloths` hold (each
/// one's sphere, close-up and macro), into `dir/patterns`.
pub fn macro_rows(
    dir: &Path,
    cloths: &[&SheetMaterial],
    size: (u32, u32),
    samples: u32,
    threads: usize,
) -> Result<(Vec<MacroImage>, Vec<MacroImage>), String> {
    let write = |scene: &Scene, file: String, caption: String| -> Result<MacroImage, String> {
        let shot = render_progressive(scene, samples, threads, None);
        let path = dir.join(&file);
        crate::write_png(&path, size.0, size.1, &shot.to_rgb8(scene))
            .map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(MacroImage { file, caption })
    };
    let mut fields = Vec::new();
    for m in cloths {
        let scene = macro_scene(&m.material, &m.pattern, size);
        let file = format!("patterns/{}-macro.png", m.key.to_lowercase());
        fields.push(write(
            &scene,
            file,
            format!("{}: {}", m.label, pattern_info(&m.pattern)),
        )?);
    }
    let mut alternatives = Vec::new();
    for (n, (key, what, change)) in ALTERNATIVES.iter().enumerate() {
        let Some(m) = cloths.iter().find(|m| m.key == *key) else {
            continue;
        };
        let mut pattern = m.pattern.clone();
        change(&mut pattern);
        for (tag, scene) in [
            (
                "sphere",
                sheet_scene(&m.material, Some(&pattern), size, Object::Sphere, false),
            ),
            (
                "close-up",
                sheet_scene(&m.material, Some(&pattern), size, Object::Sphere, true),
            ),
            ("macro", macro_scene(&m.material, &pattern, size)),
        ] {
            let file = format!("patterns/alternative-{n}-{tag}.png");
            alternatives.push(write(&scene, file, format!("{what}: {tag}"))?);
        }
    }
    Ok((fields, alternatives))
}

/// The macro part of the cloth sheet.
pub fn macro_html(fields: &[MacroImage], alternatives: &[MacroImage]) -> String {
    let mut s = format!(
        "<h1 style=\"margin-top:28px\">Up close: {MACRO_MM:.0} mm fields</h1>\n<p class=\"meta\">Every \
         cloth on a large flat piece seen straight from above, orthographic, {MACRO_MM:.0} mm wide, \
         under the sheet's key (raking at about 40°): the threads at their real spacing, as \
         the interface sends them.</p>\n<div class=\"macro\">"
    );
    let figure = |s: &mut String, m: &MacroImage| {
        let _ = write!(
            s,
            "<figure><img src=\"{f}\" alt=\"{c}\"><figcaption>{c}</figcaption></figure>",
            f = m.file,
            c = m.caption,
        );
    };
    for m in fields {
        figure(&mut s, m);
    }
    s.push_str("</div>\n");
    if !alternatives.is_empty() {
        s.push_str(
            "<h1 style=\"margin-top:28px\">Alternatives</h1>\n<p class=\"meta\">Sphere, close-up \
             and macro of each, to compare with its row above. <b>Denim</b>: real denim is a 3/1 \
             twill (the indigo warp on three quarters of the face), which the catalogue sends now; \
             here it is woven as the 2/2 twill of the other twills, as the weave <code>TWILL</code> \
             would.</p>\n<div class=\"macro\">",
        );
        for m in alternatives {
            figure(&mut s, m);
        }
        s.push_str("</div>\n");
    }
    s
}

/// One image of the knot row.
#[derive(Clone, Debug, PartialEq)]
pub struct KnotImage {
    /// File, relative to the sheet.
    pub file: String,
    /// Knots asked for and their diameter.
    pub asked: (u32, f32),
    /// Knots placed (fewer when no more fit the piece).
    pub placed: usize,
}

/// Renders pine's knot row into `dir/patterns`: the box's top, then the board.
pub fn knot_row(
    dir: &Path,
    pine: &SheetMaterial,
    samples: u32,
    threads: usize,
) -> Result<[Vec<KnotImage>; 2], String> {
    let mut out: [Vec<KnotImage>; 2] = Default::default();
    let pieces = [
        ("box", BOX_MM, (KNOT_WIDTH, KNOT_WIDTH)),
        ("board", BOARD_MM, (KNOT_WIDTH, KNOT_WIDTH / 3)),
    ];
    for (row, (name, dims, size)) in pieces.into_iter().enumerate() {
        for (count, d) in KNOT_ROW {
            let mut pattern = pine.pattern.clone();
            pattern.params[10] = count as f32;
            pattern.params[11] = d;
            let scene = top_scene(&pine.material, &pattern, size, dims);
            let placed = rt_core::pattern::PatternSetup::new(&scene).knot_counts()[0];
            let shot = render_progressive(&scene, samples, threads, None);
            let file = format!("patterns/knots-{name}-{count}x{d}.png");
            let path = dir.join(&file);
            crate::write_png(&path, size.0, size.1, &shot.to_rgb8(&scene))
                .map_err(|e| format!("{}: {e}", path.display()))?;
            out[row].push(KnotImage {
                file,
                asked: (count, d),
                placed,
            });
        }
    }
    Ok(out)
}

/// The knot row's part of the wood sheet.
pub fn knot_html(rows: &[Vec<KnotImage>; 2]) -> String {
    let mut s = String::from(
        "<h1 style=\"margin-top:28px\">Knots: pine</h1>\n<p class=\"meta\">Pine as the catalogue \
         sends it with 0, 2 and 6 knots of 15 mm and 6 of 30 mm (variation ± 43 %, darkness 0.9), \
         seen straight from above, orthographic. Fewer are placed when no more fit the piece \
         without touching.</p>\n",
    );
    for (row, title) in rows
        .iter()
        .zip(["Box, 60 × 40 mm face", "Board, 300 × 100 × 20 mm"])
    {
        let _ = write!(s, "<div class=\"knots\"><div><b>{title}</b></div>");
        for k in row {
            let _ = write!(
                s,
                "<figure><img src=\"{f}\" alt=\"{title}, {n} knots of {d} mm\"><figcaption>{n} × {d} mm \
                 asked, {p} placed</figcaption></figure>",
                f = k.file,
                n = k.asked.0,
                d = k.asked.1,
                p = k.placed,
            );
        }
        s.push_str("</div>\n");
    }
    s
}

/// One row of a sheet: the three images of a material.
#[derive(Clone, Debug, PartialEq)]
pub struct SheetRow {
    /// Catalogue key.
    pub key: String,
    /// English label.
    pub label: String,
    /// What the row says under the name ([`pattern_info`]: a cloth's weave and density).
    pub info: String,
    /// Image files, relative to the sheet: before, after and close-up of the sphere, then of
    /// the box.
    pub files: [String; 6],
    /// Seconds to render the after image.
    pub seconds: f64,
}

/// Renders every material of `materials` into `dir` and writes the two sheets.
pub fn run(
    dir: &Path,
    materials: &[SheetMaterial],
    size: (u32, u32),
    samples: u32,
    threads: usize,
) -> Result<(Vec<SheetRow>, Vec<SheetRow>), String> {
    let images = dir.join("patterns");
    std::fs::create_dir_all(&images).map_err(|e| format!("{}: {e}", images.display()))?;
    let (mut woods, mut cloths) = (Vec::new(), Vec::new());
    for m in materials {
        let before = Material {
            base_color: m.flat_color(),
            ..m.material.clone()
        };
        let mut files: [String; 6] = Default::default();
        let mut seconds = 0.0;
        let views: [(&Material, Option<&Pattern>, bool, &str); 3] = [
            (&before, None, false, "before"),
            (&m.material, Some(&m.pattern), false, "after"),
            (&m.material, Some(&m.pattern), true, "close"),
        ];
        for (o, object) in [Object::Sphere, Object::Box].into_iter().enumerate() {
            for (k, (material, pattern, close, tag)) in views.iter().enumerate() {
                let scene = sheet_scene(material, *pattern, size, object, *close);
                let out = render_progressive(&scene, samples, threads, None);
                if o == 0 && k == 1 {
                    seconds = out.elapsed.as_secs_f64();
                }
                let name = if o == 0 { "sphere" } else { "box" };
                let file = format!("patterns/{}-{name}-{tag}.png", m.key.to_lowercase());
                let path = dir.join(&file);
                crate::write_png(&path, size.0, size.1, &out.to_rgb8(&scene))
                    .map_err(|e| format!("{}: {e}", path.display()))?;
                files[o * 3 + k] = file;
            }
        }
        let row = SheetRow {
            key: m.key.clone(),
            label: m.label.clone(),
            info: pattern_info(&m.pattern),
            files,
            seconds,
        };
        if m.pattern.kind == PATTERN_WOOD {
            woods.push(row);
        } else {
            cloths.push(row);
        }
    }
    let knots = match materials.iter().find(|m| m.key == "PINE") {
        Some(pine) => knot_html(&knot_row(dir, pine, samples, threads)?),
        None => String::new(),
    };
    let fabrics: Vec<&SheetMaterial> = materials
        .iter()
        .filter(|m| m.pattern.kind == PATTERN_CLOTH)
        .collect();
    let macros = if fabrics.is_empty() {
        String::new()
    } else {
        let (fields, alternatives) = macro_rows(dir, &fabrics, size, samples, threads)?;
        macro_html(&fields, &alternatives)
    };
    for (name, title, rows, extra) in [
        ("wood-sheet.html", "Woods", &woods, knots.as_str()),
        ("cloth-sheet.html", "Cloths", &cloths, macros.as_str()),
    ] {
        if rows.is_empty() {
            continue;
        }
        let path = dir.join(name);
        let page = html(title, rows, size, samples).replace("</body>", &format!("{extra}</body>"));
        std::fs::write(&path, page).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok((woods, cloths))
}

/// A sheet as a self-contained page: one row per material, before, after and close-up.
pub fn html(title: &str, rows: &[SheetRow], size: (u32, u32), samples: u32) -> String {
    let mut s = String::new();
    let _ = write!(
        s,
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{title} sheet</title>\n<style>\n\
         :root {{ color-scheme: light dark; --bg: #f4f4f4; --fg: #1a1a1a; --muted: #666; }}\n\
         @media (prefers-color-scheme: dark) {{ :root {{ --bg: #141414; --fg: #e8e8e8; --muted: #999; }} }}\n\
         body {{ margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg);\n\
                font: 14px/1.4 system-ui, sans-serif; }}\n\
         h1 {{ font-size: 18px; font-weight: 600; margin: 0 0 4px; }}\n\
         p.meta {{ margin: 0 0 20px; color: var(--muted); max-width: 70ch; }}\n\
         .row {{ display: grid; gap: 6px; grid-template-columns: 8rem repeat(6, minmax(0, {w}px));\n\
                align-items: center; margin-bottom: 12px; }}\n\
         .row b {{ font-weight: 600; }} .row span {{ display: block; color: var(--muted); }}\n\
         img {{ width: 100%; height: auto; display: block; }}\n\
         .head {{ color: var(--muted); }}\n\
         .knots {{ display: grid; gap: 6px; grid-template-columns: 8rem repeat(4, minmax(0, 1fr));\n\
                  align-items: start; margin-bottom: 12px; max-width: 1600px; }}\n\
         .macro {{ display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax({w}px, 1fr));\n\
                  margin-bottom: 12px; max-width: 1800px; }}\n\
         figure {{ margin: 0; }} figcaption {{ color: var(--muted); font-size: 12px; }}\n\
         @media (max-width: 900px) {{ .row {{ grid-template-columns: repeat(3, minmax(0, 1fr)); }}\n\
           .row > div:first-child, .knots > div:first-child {{ grid-column: 1 / -1; }}\n\
           .knots {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }} }}\n\
         </style>\n</head>\n<body>\n<h1>{title}: before and after E6</h1>\n\
         <p class=\"meta\">Spheres of 100 mm rendered by the engine (rt), {}x{} px, {samples} spp, \
         ACES, one soft key, a fill and a dim studio dome. <b>Before</b>: the flat colour the engine drew until E6. <b>After</b>: the \
         procedural pattern with its relief. <b>Close-up</b>: the after at four times the focal \
         length. Then the same three of a 60 × 40 × 25 mm box. Materials as the interface writes \
         them, on a part of 100 mm (wood and cloth sizes are physical: they do not depend on it).</p>\n\
         <div class=\"row head\"><div></div><div>Sphere, before</div><div>After</div>\
         <div>Close-up</div><div>Box, before</div><div>After</div><div>Close-up</div></div>\n",
        size.0,
        size.1,
        w = size.0,
    );
    for r in rows {
        let _ = writeln!(
            s,
            "<div class=\"row\"><div><b>{label}</b><span>{key}{info} · {secs:.1} s</span></div>\
             <img src=\"{a}\" alt=\"{label}, sphere, before\"><img src=\"{b}\" alt=\"{label}, sphere, after\">\
             <img src=\"{c}\" alt=\"{label}, sphere, close-up\"><img src=\"{d}\" alt=\"{label}, box, before\">\
             <img src=\"{e}\" alt=\"{label}, box, after\"><img src=\"{f}\" alt=\"{label}, box, close-up\"></div>",
            label = r.label,
            key = r.key,
            info = if r.info.is_empty() {
                String::new()
            } else {
                format!(" · {}", r.info)
            },
            secs = r.seconds,
            a = r.files[0],
            b = r.files[1],
            c = r.files[2],
            d = r.files[3],
            e = r.files[4],
            f = r.files[5],
        );
    }
    s.push_str("</body>\n</html>\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        let mut scene = sphere_scene(&Material::default(), None, (8, 8), false);
        scene.materials = vec![Material::default(), Material::default()];
        scene.patterns = vec![
            Pattern::default(),
            Pattern {
                material: 1,
                scale_mm: 3.0,
                ..Pattern::default()
            },
        ];
        let mut bytes = scene.to_rsb();
        let mut payload = 2u32.to_le_bytes().to_vec();
        for name in ["OAK\tOak", "ASH\tAsh"] {
            payload.extend_from_slice(&(name.len() as u32).to_le_bytes());
            payload.extend_from_slice(name.as_bytes());
            payload.resize(payload.len().div_ceil(4) * 4, 0);
        }
        bytes.extend_from_slice(b"NAME");
        bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&payload);
        bytes
    }

    #[test]
    fn reads_the_materials_and_their_names() {
        let m = read_materials(&fixture()).expect("fixture");
        assert_eq!(m.len(), 2);
        assert_eq!((m[0].key.as_str(), m[0].label.as_str()), ("OAK", "Oak"));
        assert_eq!(m[1].key, "ASH");
        assert_eq!(m[1].pattern.material, 0);
        let p = &m[0].pattern;
        let flat = m[0].flat_color();
        assert!((flat.r - (p.color_a.r * 0.6 + p.color_b.r * 0.4)).abs() < 1.0e-6);
        assert!(read_materials(&fixture()[..fixture().len() - 12]).is_err());
    }

    #[test]
    fn the_sheet_lists_every_image() {
        let rows = vec![SheetRow {
            key: "OAK".into(),
            label: "Oak".into(),
            info: String::new(),
            files: [
                "a.png".into(),
                "b.png".into(),
                "c.png".into(),
                "d.png".into(),
                "e.png".into(),
                "f.png".into(),
            ],
            seconds: 1.0,
        }];
        let page = html("Woods", &rows, (8, 8), 4);
        for f in ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"] {
            assert!(page.contains(f));
        }
        assert!(page.starts_with("<!doctype html>") && page.contains("<title>Woods sheet</title>"));
    }

    #[test]
    fn a_cloth_row_says_its_weave_and_density() {
        let denim = Pattern {
            kind: PATTERN_CLOTH,
            scale_mm: 10.0 / 24.0,
            variant: 6,
            ..Pattern::default()
        };
        assert_eq!(pattern_info(&denim), "twill 3/1 · 24/cm (0.42 mm)");
        assert_eq!(pattern_info(&Pattern::default()), "");
        let one = |f: &str| MacroImage {
            file: f.into(),
            caption: f.into(),
        };
        let page = macro_html(&[one("a.png")], &[one("b.png")]);
        assert!(page.contains("a.png") && page.contains("b.png") && page.contains("Alternatives"));
        assert!(!macro_html(&[one("a.png")], &[]).contains("Alternatives"));
        // The macro sees a field of MACRO_MM straight from above.
        let scene = macro_scene(&Material::default(), &denim, (8, 8));
        assert!(scene.camera.ortho && scene.camera.ortho_width == MACRO_MM);
    }
}

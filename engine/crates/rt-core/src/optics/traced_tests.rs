//! Tests of the traced lens (O2). The prescriptions are the 16 of `src/data/lenses.json`, read by
//! a small JSON reader written for the test; a reference trace in `f64` lives here only.

use super::paraxial;
use super::traced::*;
use super::LensParams;
use crate::math::Vec3;

// --- a JSON reader for the catalogue (test only) -----------------------------------------------

#[derive(Clone, Debug, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    fn get(&self, key: &str) -> &Json {
        match self {
            Json::Obj(v) => v
                .iter()
                .find(|(k, _)| k == key)
                .map_or(&Json::Null, |(_, x)| x),
            _ => &Json::Null,
        }
    }
    fn num(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }
    fn str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }
    fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(v) => v,
            _ => &[],
        }
    }
}

fn parse_json(text: &str) -> Json {
    fn ws(b: &[u8], i: &mut usize) {
        while *i < b.len() && (b[*i] as char).is_ascii_whitespace() {
            *i += 1;
        }
    }
    fn value(b: &[u8], i: &mut usize) -> Json {
        ws(b, i);
        match b[*i] {
            b'{' => {
                *i += 1;
                let mut v = Vec::new();
                loop {
                    ws(b, i);
                    if b[*i] == b'}' {
                        *i += 1;
                        break;
                    }
                    let Json::Str(k) = value(b, i) else {
                        panic!("key")
                    };
                    ws(b, i);
                    *i += 1; // ':'
                    let x = value(b, i);
                    v.push((k, x));
                    ws(b, i);
                    if b[*i] == b',' {
                        *i += 1;
                    }
                }
                Json::Obj(v)
            }
            b'[' => {
                *i += 1;
                let mut v = Vec::new();
                loop {
                    ws(b, i);
                    if b[*i] == b']' {
                        *i += 1;
                        break;
                    }
                    v.push(value(b, i));
                    ws(b, i);
                    if b[*i] == b',' {
                        *i += 1;
                    }
                }
                Json::Arr(v)
            }
            b'"' => {
                *i += 1;
                let mut s = Vec::new();
                while b[*i] != b'"' {
                    if b[*i] == b'\\' {
                        *i += 1;
                    }
                    s.push(b[*i]);
                    *i += 1;
                }
                *i += 1;
                Json::Str(String::from_utf8_lossy(&s).into_owned())
            }
            b'n' => {
                *i += 4;
                Json::Null
            }
            b't' => {
                *i += 4;
                Json::Bool(true)
            }
            b'f' => {
                *i += 5;
                Json::Bool(false)
            }
            _ => {
                let start = *i;
                while *i < b.len() && b"+-0123456789.eE".contains(&b[*i]) {
                    *i += 1;
                }
                Json::Num(std::str::from_utf8(&b[start..*i]).unwrap().parse().unwrap())
            }
        }
    }
    let mut i = 0;
    value(text.as_bytes(), &mut i)
}

const CATALOGUE: &str = include_str!("../../../../../src/data/lenses.json");

/// The catalogue's lenses: key, the JSON record.
fn catalogue() -> Vec<(String, Json)> {
    parse_json(CATALOGUE)
        .get("lenses")
        .arr()
        .iter()
        .map(|l| (l.get("key").str().unwrap().to_string(), l.clone()))
        .collect()
}

/// A catalogue lens as the LENS section has it (`src/io/rsb.ts` `prescriptionToRsb`, without the
/// anamorphic composite).
fn prescription(l: &Json) -> Prescription {
    let surfaces: Vec<SurfaceSpec> = l
        .get("surfaces")
        .arr()
        .iter()
        .map(|s| {
            let kind = match s.get("kind").str().unwrap() {
                "mirror" => SURFACE_MIRROR,
                "plane" => SURFACE_PLANE,
                "asphere" => SURFACE_ASPHERE,
                "cylinder" => {
                    if s.get("axis").str() == Some("x") {
                        SURFACE_CYLINDER_X
                    } else {
                        SURFACE_CYLINDER_Y
                    }
                }
                _ => SURFACE_SPHERE,
            };
            let glass = s.get("glass");
            SurfaceSpec {
                kind,
                radius: s.get("r").num().unwrap_or(0.0) as f32,
                thickness: s.get("d").num().unwrap_or(0.0) as f32,
                nd: glass.get("nd").num().unwrap_or(1.0) as f32,
                vd: glass.get("vd").num().unwrap_or(0.0) as f32,
                semi_aperture: s.get("semiAperture").num().unwrap_or(0.0) as f32,
                coating: match s.get("coating").str() {
                    Some("none") => COATING_UNCOATED,
                    Some("single") => COATING_SINGLE,
                    Some("multi") => COATING_MULTI,
                    _ => COATING_NONE,
                },
                conic: 0.0,
                aspheric: [0.0; 4],
            }
        })
        .collect();
    let stop = l
        .get("surfaces")
        .arr()
        .iter()
        .position(|s| s.get("role").str() == Some("stop"))
        .unwrap() as u32;
    let focus = l.get("focus");
    Prescription {
        stop,
        focus_mode: match focus.get("mode").str() {
            Some("internal") => FOCUS_INTERNAL,
            Some("floating") => FOCUS_FLOATING,
            _ => FOCUS_UNIT,
        },
        f_number_min: l.get("fNumber").num().unwrap_or(0.0) as f32,
        magnification: if focus.get("mode").str() == Some("floating") {
            (0.1, 0.2)
        } else {
            (0.0, 0.0)
        },
        distortion: 0.0,
        vignetting: 0.0,
        spherical: 0.0,
        breathing: 0.0,
        moving: focus
            .get("moving")
            .arr()
            .iter()
            .map(|m| MovingGap {
                surface: m.get("surface").num().unwrap() as u32,
                base: m.get("dBase").num().unwrap() as f32,
                near: m.get("dNear").num().unwrap() as f32,
            })
            .collect(),
        surfaces,
    }
}

/// The unscaled surfaces of a lens with the d-line index in every band (the paraxial checks).
fn d_line_surfaces(p: &Prescription) -> Vec<Surface> {
    p.surfaces
        .iter()
        .map(|s| Surface {
            kind: if s.radius == 0.0 && s.kind != SURFACE_MIRROR {
                SURFACE_PLANE
            } else {
                s.kind
            },
            curvature: if s.radius == 0.0 { 0.0 } else { 1.0 / s.radius },
            thickness: s.thickness,
            index: [s.nd; 3],
            semi_aperture: s.semi_aperture,
            conic: 0.0,
            aspheric: [0.0; 4],
            transmittance: [1.0; 3],
        })
        .collect()
}

#[test]
fn the_paraxial_focal_length_and_back_focus_of_the_16_lenses_match_the_research() {
    // As tests/lenses.test.ts does in TypeScript (f64), here in the engine's f32: within the
    // report's 0.05 % (its own tolerance where the catalogue gives one).
    let lenses = catalogue();
    assert_eq!(lenses.len(), 16);
    let mut checked = 0;
    for (key, l) in &lenses {
        let reported = l.get("reported");
        let Some(efl) = reported.get("eflMm").num() else {
            assert_eq!(key, "anamorphic_adapter_2x");
            continue;
        };
        let tol = reported.get("toleranceRel").num().unwrap_or(5.0e-4);
        let s = d_line_surfaces(&prescription(l));
        let (f, b) = paraxial::efl_bfl(&s, 1).expect("focal");
        assert!(
            (f64::from(f) - efl).abs() / efl <= tol,
            "{key}: EFL {f} against {efl}"
        );
        if let Some(bfl) = reported.get("bflMm").num() {
            assert!(
                (f64::from(b) - bfl).abs() / bfl.abs() <= tol,
                "{key}: BFL {b} against {bfl}"
            );
        }
        checked += 1;
    }
    assert_eq!(checked, 15);
}

/// A lens of the catalogue prepared for a camera (focal, f-number, focus, sensor).
fn traced(key: &str, focal: f32, fstop: f32, focus: f32) -> TracedLens {
    traced_with(key, focal, fstop, focus, |_| {})
}

/// [`traced`] with the prescription's artistic overrides changed by `edit`.
fn traced_with(
    key: &str,
    focal: f32,
    fstop: f32,
    focus: f32,
    edit: impl Fn(&mut Prescription),
) -> TracedLens {
    let lenses = catalogue();
    let (_, l) = lenses
        .iter()
        .find(|(k, _)| k == key)
        .expect("a catalogue lens");
    let mut p = prescription(l);
    edit(&mut p);
    let params = LensParams {
        prescription: Some(p),
        ..LensParams::default()
    };
    TracedLens::new(
        params.prescription.as_ref().unwrap(),
        &params,
        CameraOptics {
            focal_mm: focal,
            fstop,
            focus_dist: focus,
            sensor_mm: 36.0,
        },
    )
    .unwrap_or_else(|e| panic!("{key}: {e}"))
}

/// The same trace in f64 (reference only): a sphere or plane after another, from `p` along `d`.
fn trace_f64(
    surfaces: &[(f64, f64, f64)],
    p: [f64; 3],
    d: [f64; 3],
) -> Option<([f64; 3], [f64; 3])> {
    // (curvature, vertex z, index after) per surface, traced backwards from the last.
    let (mut p, mut d) = (p, d);
    let mut n_cur = surfaces[surfaces.len() - 1].2;
    for i in (0..surfaces.len()).rev() {
        let (c, zv, _) = surfaces[i];
        let t0 = (zv - p[2]) / d[2];
        let (x0, y0) = (p[0] + d[0] * t0, p[1] + d[1] * t0);
        let (q, n) = if c == 0.0 {
            ([x0, y0, 0.0], [0.0, 0.0, -1.0])
        } else {
            let r2 = x0 * x0 + y0 * y0;
            let b = d[2] - c * (x0 * d[0] + y0 * d[1]);
            let disc = b * b - c * c * r2;
            if disc < 0.0 {
                return None;
            }
            let t = c * r2
                / if b >= 0.0 {
                    b + disc.sqrt()
                } else {
                    b - disc.sqrt()
                };
            let q = [x0 + d[0] * t, y0 + d[1] * t, d[2] * t];
            (q, [c * q[0], c * q[1], c * q[2] - 1.0])
        };
        p = [q[0], q[1], zv + q[2]];
        let n_next = if i == 0 { 1.0 } else { surfaces[i - 1].2 };
        if n_next != n_cur {
            let eta = n_cur / n_next;
            let mut nn = n;
            let mut cos_i = -(d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]);
            if cos_i < 0.0 {
                nn = [-nn[0], -nn[1], -nn[2]];
                cos_i = -cos_i;
            }
            let k = 1.0 - eta * eta * (1.0 - cos_i * cos_i);
            if k < 0.0 {
                return None;
            }
            let f = eta * cos_i - k.sqrt();
            d = [
                d[0] * eta + nn[0] * f,
                d[1] * eta + nn[1] * f,
                d[2] * eta + nn[2] * f,
            ];
            n_cur = n_next;
        }
    }
    Some((p, d))
}

fn double_gauss_d_line() -> (Prescription, Vec<Surface>) {
    let lenses = catalogue();
    let (_, l) = lenses
        .iter()
        .find(|(k, _)| k == "double_gauss_normal")
        .unwrap();
    let p = prescription(l);
    let s = d_line_surfaces(&p);
    (p, s)
}

/// A bare tracer over d-line surfaces (no rims), as the engine traces.
fn bare(surfaces: Vec<Surface>, stop: usize) -> TracedLens {
    TracedLens::bare(surfaces, stop)
}

#[test]
fn axial_rays_from_the_back_focus_of_the_double_gauss_leave_parallel() {
    // Research §6.1: from the paraxial focus, real rays at heights up to 10 mm on the rear element
    // leave the front parallel to the axis within 2e-4 of slope (spherical aberration only).
    let (_, s) = double_gauss_d_line();
    let (_, bfl) = paraxial::efl_bfl(&s, 1).unwrap();
    let lens = bare(s.clone(), 5);
    let z_last: f32 = s[..s.len() - 1].iter().map(|x| x.thickness).sum();
    let focus = Vec3::new(0.0, 0.0, z_last + bfl);
    for h in [1.0f32, 4.0, 7.0, 10.0] {
        let d = (Vec3::new(h, 0.0, z_last) - focus).normalize();
        match lens.trace(focus, d, 1, false) {
            Traced::Out { dir, .. } => {
                let slope = (dir.x / dir.z).abs();
                assert!(slope < 2.0e-4, "height {h}: slope {slope}");
            }
            Traced::Blocked => panic!("height {h} blocked"),
        }
    }
}

#[test]
fn the_f32_trace_agrees_with_an_f64_reference_within_a_ten_thousandth_of_a_millimetre() {
    let (_, s) = double_gauss_d_line();
    let lens = bare(s.clone(), 5);
    let mut z = 0.0f64;
    let reference: Vec<(f64, f64, f64)> = s
        .iter()
        .map(|x| {
            let at = z;
            z += f64::from(x.thickness);
            (f64::from(x.curvature), at, f64::from(x.index[1]))
        })
        .collect();
    let z_last = reference[reference.len() - 1].1;
    let mut worst = 0.0f64;
    for (fx, fy, rx, ry) in [
        (0.0, 0.0, 5.0, 0.0),
        (8.0, -3.0, -6.0, 4.0),
        (15.0, 10.0, 2.0, -9.0),
        (-20.0, 5.0, 12.0, 3.0),
    ] {
        let film = [fx, fy, z_last + 72.0];
        let q = [rx, ry, z_last];
        let dl =
            ((q[0] - film[0]).powi(2) + (q[1] - film[1]).powi(2) + (q[2] - film[2]).powi(2)).sqrt();
        let d64 = [
            (q[0] - film[0]) / dl,
            (q[1] - film[1]) / dl,
            (q[2] - film[2]) / dl,
        ];
        let (p64, _) = trace_f64(&reference, film, d64).expect("reference passes");
        let film32 = Vec3::new(fx as f32, fy as f32, film[2] as f32);
        let d32 = Vec3::new(d64[0] as f32, d64[1] as f32, d64[2] as f32);
        let Traced::Out { origin, .. } = lens.trace(film32, d32, 1, false) else {
            panic!("blocked")
        };
        for (a, b) in [(origin.x, p64[0]), (origin.y, p64[1]), (origin.z, p64[2])] {
            worst = worst.max((f64::from(a) - b).abs());
        }
    }
    assert!(worst < 1.0e-4, "worst difference {worst} mm");
}

#[test]
fn every_catalogue_lens_prepares_and_reports_what_it_does() {
    // Each lens of the catalogue (the anamorphic adapter needs its master lens: the interface
    // composes them), scaled to 50 mm, wide open, focused at 2 m: the engine's own numbers.
    for (key, l) in catalogue() {
        if key == "anamorphic_adapter_2x" {
            continue;
        }
        let lens = traced(&key, 50.0, 0.0, 2000.0);
        let info = lens.info();
        assert!(
            (info.efl_mm - 50.0).abs() < 1.0e-3,
            "{key}: EFL {}",
            info.efl_mm
        );
        let fastest = l.get("fNumber").num().unwrap_or(0.0) as f32;
        assert!(
            info.f_number >= fastest * 0.999,
            "{key}: f/{} faster than f/{fastest}",
            info.f_number
        );
        assert!(
            info.t_stop >= info.f_number,
            "{key}: T{} below f/{}",
            info.t_stop,
            info.f_number
        );
        assert!(
            info.transmittance.iter().all(|&t| t > 0.3 && t <= 1.0),
            "{key}: {:?}",
            info.transmittance
        );
        assert!(
            info.sensor_mm > 0.0,
            "{key}: the sensor at {}",
            info.sensor_mm
        );
        let ri = &info.relative_illumination;
        assert!(
            !ri.is_empty() && (ri[0].1 - 1.0).abs() < 1.0e-6,
            "{key}: {ri:?}"
        );
        assert!(
            ri.iter().all(|&(_, v)| (0.0..=1.05).contains(&v)),
            "{key}: {ri:?}"
        );
        assert!(!info.distortion.is_empty(), "{key}: no distortion profile");
        assert!(
            info.elements >= 1 && info.groups >= 1 && info.groups <= info.elements,
            "{key}"
        );
        // The cross-section is the lens as traced: every surface, scaled and focused, each with
        // a semi-aperture (the derived ones too), the iris inside the stop's, the sensor behind.
        let section = &info.section;
        let surfaces = l.get("surfaces").arr();
        assert_eq!(section.surfaces.len(), surfaces.len(), "{key}");
        let stop = surfaces
            .iter()
            .position(|s| s.get("role").str() == Some("stop"))
            .unwrap();
        assert_eq!(section.stop as usize, stop, "{key}");
        assert!(
            section.surfaces.iter().all(|s| s.semi_aperture > 0.0),
            "{key}: {:?}",
            section.surfaces
        );
        assert!(
            section.stop_radius > 0.0
                && section.stop_radius <= section.surfaces[stop].semi_aperture * 1.0001,
            "{key}: iris {} in a stop of {}",
            section.stop_radius,
            section.surfaces[stop].semi_aperture
        );
        let last = section.surfaces[section.surfaces.len() - 1].z;
        assert!(
            (section.sensor_z - last - info.sensor_mm).abs() < 1.0e-3,
            "{key}"
        );
        assert!(
            (section.surfaces[0].z, last - section.surfaces[0].z) == (0.0, info.length_mm)
                || (last - section.surfaces[0].z).abs() == info.length_mm,
            "{key}"
        );
        let json = info.to_json();
        assert!(
            json.contains(&format!("\"section\":{{\"stop\":{stop},\"stopRadiusMm\":")),
            "{key}: {json}"
        );
    }
}

/// Where two traced rays (lens frame) come closest: the point and the gap, in `f64`.
fn closest(a: (Vec3, Vec3), b: (Vec3, Vec3)) -> ([f64; 3], f64) {
    let v = |p: Vec3| [f64::from(p.x), f64::from(p.y), f64::from(p.z)];
    let (o1, d1, o2, d2) = (v(a.0), v(a.1), v(b.0), v(b.1));
    let dot = |p: [f64; 3], q: [f64; 3]| p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    let w = [o1[0] - o2[0], o1[1] - o2[1], o1[2] - o2[2]];
    let (aa, bb, cc, dd, ee) = (
        dot(d1, d1),
        dot(d1, d2),
        dot(d2, d2),
        dot(d1, w),
        dot(d2, w),
    );
    let den = aa * cc - bb * bb;
    let s = (bb * ee - cc * dd) / den;
    let t = (aa * ee - bb * dd) / den;
    let p = [o1[0] + d1[0] * s, o1[1] + d1[1] * s, o1[2] + d1[2] * s];
    let q = [o2[0] + d2[0] * t, o2[1] + d2[1] * t, o2[2] + d2[2] * t];
    let gap = ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2)).sqrt();
    (
        [
            (p[0] + q[0]) / 2.0,
            (p[1] + q[1]) / 2.0,
            (p[2] + q[2]) / 2.0,
        ],
        gap,
    )
}

#[test]
fn the_axis_focuses_at_the_focus_distance_with_unit_internal_and_floating_focus() {
    // Rays from the centre of the sensor through two points of the pupil meet in front of the
    // lens at the focus distance from the camera position (the entrance pupil at infinity), up
    // to the lens's own spherical aberration (paraxial focus, rays near the axis).
    for (key, focus) in [
        ("double_gauss_normal", 1500.0f32),
        ("telephoto_internal_focus", 3000.0),
        ("macro_floating", 600.0),
        ("triplet", 2000.0),
    ] {
        let lens = traced(key, 50.0, 8.0, focus);
        let a = match lens.chief(0.0, 0.0, (0.15, 0.0)) {
            Traced::Out { origin, dir } => (origin, dir),
            Traced::Blocked => panic!("{key}: blocked"),
        };
        let b = match lens.chief(0.0, 0.0, (-0.15, 0.0)) {
            Traced::Out { origin, dir } => (origin, dir),
            Traced::Blocked => panic!("{key}: blocked"),
        };
        let (p, gap) = closest(a, b);
        // The lens frame's axis points from the object to the sensor: the object is at −z.
        let distance = f64::from(lens.pupil_z()) - p[2];
        assert!(gap < 0.5, "{key}: the rays miss each other by {gap} mm");
        assert!(
            (distance - f64::from(focus)).abs() < 0.03 * f64::from(focus),
            "{key}: focused at {distance} mm, not {focus}"
        );
    }
}

#[test]
fn the_distortion_is_measured_against_the_scale_near_the_axis_at_any_focus() {
    // The double Gauss has little distortion (under 2 % of barrel at the corner of a 50 mm frame)
    // at infinity and close up alike: focused close, the unit-focus lens sits further
    // from the sensor and the frame narrows (the image scale grows past the focal length), which
    // is breathing, not distortion.
    for focus in [1.0e6f32, 3000.0, 500.0] {
        let lens = traced("double_gauss_normal", 50.0, 8.0, focus);
        let info = lens.info();
        let corner = info.distortion.last().unwrap();
        assert!(
            corner.1.abs() < 2.5,
            "focused at {focus}: {corner:?} (scale {} mm)",
            info.image_scale_mm
        );
        assert!(info.image_scale_mm >= 49.9, "{}", info.image_scale_mm);
    }
    let near = traced("double_gauss_normal", 50.0, 8.0, 500.0);
    assert!(
        near.info().image_scale_mm > 54.0,
        "{}",
        near.info().image_scale_mm
    );
    // The heights of both profiles run from the axis (the illumination's first is 1) to the
    // frame's corner.
    let ri = &near.info().relative_illumination;
    assert_eq!(ri.len(), PROFILE_POINTS + 1);
    assert_eq!(ri[0], (0.0, 1.0));
    assert!((ri[PROFILE_POINTS].0 - 0.6 * 36.0).abs() < 1.0e-4);
}

#[test]
fn the_artistic_distortion_and_vignetting_show_in_the_profile_and_the_chief_rays() {
    let plain = traced("double_gauss_normal", 50.0, 4.0, 3000.0);
    let barrel = traced_with("double_gauss_normal", 50.0, 4.0, 3000.0, |p| {
        p.distortion = -1.0;
        p.vignetting = 0.5;
    });
    let at = |l: &TracedLens| l.info().distortion.last().unwrap().1;
    // −1 is 25 % less film height at the corner: about −25 % (−20 % more of the scale's
    // change), well below the lens's own.
    assert!(
        at(&barrel) < at(&plain) - 15.0,
        "{} against {}",
        at(&barrel),
        at(&plain)
    );
    let ri = |l: &TracedLens| l.info().relative_illumination.last().unwrap().1;
    assert!(
        ri(&barrel) < 0.75 * ri(&plain),
        "{} against {}",
        ri(&barrel),
        ri(&plain)
    );
    // The chief ray of a sensor point (the exact passes) goes where the samples of that point go:
    // their mean direction, through the whole pupil.
    let (x, y) = (14.0f32, 9.0f32);
    let chief = match barrel.chief(x, y, (0.0, 0.0)) {
        Traced::Out { dir, .. } => dir,
        Traced::Blocked => panic!("blocked"),
    };
    let mut mean = Vec3::ZERO;
    let n = 24;
    for j in 0..n {
        for i in 0..n {
            let u = ((i as f32 + 0.5) / n as f32, (j as f32 + 0.5) / n as f32);
            if let (Traced::Out { dir, .. }, w) = barrel.sample(x, y, u, 1, 0.0) {
                mean += dir * w;
            }
        }
    }
    let mean = mean.normalize();
    let angle = (1.0 - mean.dot(chief).min(1.0)).max(0.0).sqrt() * std::f32::consts::SQRT_2;
    assert!(
        angle < 0.002,
        "the chief ray is {angle} rad off the samples"
    );
}

#[test]
fn the_rims_the_source_does_not_give_pass_the_real_rays_of_the_frame() {
    // The fast double Gauss gives one semi-aperture (its stop's): the rest, sized by a paraxial
    // chief ray alone, fell short of the real rays of the corner and cut the frame's corners
    // (0.79 at f/1.4 on 50 mm); widened to the real rays, the falloff is the lens's own.
    let lens = traced("double_gauss_fast", 50.0, 0.0, 3000.0);
    let corner = lens.info().relative_illumination.last().unwrap().1;
    assert!(
        corner > 0.85,
        "relative illumination {corner} at the corner"
    );
}

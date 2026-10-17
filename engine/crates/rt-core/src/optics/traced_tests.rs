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

#[test]
fn a_traced_lens_without_cylinders_ignores_the_thin_lens_squeeze() {
    // The thin lens's anamorphic squeeze would stretch a spherical lens's image: a traced lens
    // desqueezes by what it traces (nothing, without cylinders).
    let ray = |squeeze: f32| {
        let mut scene = crate::example::o2_scene();
        scene.camera.lens = Some(
            super::Lens::new(LensParams {
                squeeze,
                prescription: Some(crate::example::double_gauss()),
                ..LensParams::default()
            })
            .unwrap(),
        );
        scene.camera.prepare_lens().unwrap();
        scene.camera.generate_ray(4.0 / 3.0, 0.9, 0.2, (0.0, 0.0))
    };
    let (a, b) = (ray(1.0), ray(2.0));
    assert_eq!((a.origin, a.dir), (b.origin, b.dir));
}

#[test]
fn the_iris_short_cuts_give_the_exact_edge_answers() {
    // Inside the inscribed circle every point passes and beyond the circumradius none does, for
    // the round iris, straight and curved blades, with and without an obstruction: the short cuts
    // of the trace answer as the exact edge does, point by point.
    use super::pupil::Iris;
    for (blades, roundness, rotation, obstruction) in [
        (0u32, 0.0f32, 0.0f32, 0.0f32),
        (5, 0.0, 0.0, 0.0),
        (6, 0.0, 30.0, 0.3),
        (7, 0.3, 10.0, 0.0),
        (9, 1.0, 0.0, 0.2),
    ] {
        let iris = Iris::new(blades, roundness, rotation);
        let inner = 0.9998 * iris.inscribed();
        let n = 400;
        for j in 0..n {
            for i in 0..n {
                let x = -1.2 + 2.4 * (i as f32 + 0.5) / n as f32;
                let y = -1.2 + 2.4 * (j as f32 + 0.5) / n as f32;
                let exact = iris.signed_distance(x, y) > 0.0
                    || (obstruction > 0.0 && iris.gauge(x, y) < obstruction);
                assert_eq!(
                    super::traced::iris_stops(&iris, inner * inner, obstruction, x, y),
                    exact,
                    "{blades} blades, roundness {roundness}: ({x}, {y})"
                );
            }
        }
    }
}

/// The bits of a traced sample, to compare two of them exactly.
fn sample_bits(t: (Traced, f32)) -> (Option<[u32; 6]>, u32) {
    let rays = match t.0 {
        Traced::Out { origin, dir } => {
            Some([origin.x, origin.y, origin.z, dir.x, dir.y, dir.z].map(f32::to_bits))
        }
        Traced::Blocked => None,
    };
    (rays, t.1.to_bits())
}

#[test]
fn a_batch_of_samples_gives_the_bits_of_the_samples_one_by_one() {
    // Every lens of the catalogue that forms an image, plain and with every override and the
    // swirl, and batches of every length: each lane is the scalar sample, bit for bit.
    let mut rng = crate::rng::Pcg32::seeded(7, 11);
    let mut checked = 0;
    for (key, _) in catalogue() {
        if key == "anamorphic_adapter_2x" {
            continue;
        }
        for (overrides, swirl) in [(false, 0.0f32), (true, 0.6)] {
            let lens = traced_with(&key, 50.0, 0.0, 1500.0, |p| {
                if overrides {
                    p.distortion = 0.4;
                    p.vignetting = 0.3;
                    p.spherical = -0.5;
                    p.breathing = 0.5;
                }
            });
            for n in [1usize, 3, LANES] {
                for _ in 0..40 {
                    let samples: Vec<BatchSample> = (0..n)
                        .map(|_| BatchSample {
                            x: 44.0 * rng.next_f32() - 22.0,
                            y: 30.0 * rng.next_f32() - 15.0,
                            u: (rng.next_f32(), rng.next_f32()),
                            band: (rng.next_u32() % 3) as usize,
                        })
                        .collect();
                    let batch = lens.sample_batch(&samples, swirl);
                    for (k, s) in samples.iter().enumerate() {
                        let one = lens.sample(s.x, s.y, s.u, s.band, swirl);
                        assert_eq!(
                            sample_bits(batch[k]),
                            sample_bits(one),
                            "{key}, lane {k} of {n}: {s:?}"
                        );
                        checked += 1;
                    }
                    for lane in &batch[n..] {
                        assert_eq!(sample_bits(*lane), sample_bits((Traced::Blocked, 0.0)));
                    }
                }
            }
        }
    }
    assert!(checked > 10_000, "{checked}");
}

#[test]
fn the_tiles_batched_camera_samples_are_the_samples_one_by_one() {
    // What the tiles trace through a traced lens, a row at a time in batches, is what
    // `camera_sample_filtered` gives pixel by pixel: the same rays, weights and filter paths, also
    // with filters, the swirl and a row whose length is not a multiple of the batch.
    use crate::render::{camera_sample_filtered, camera_samples};
    use crate::sampler::PixelSampler;
    let mut scene = crate::example::o2_scene();
    scene.render.width = 37;
    scene.render.height = 5;
    let mut with_filters = scene.clone();
    with_filters.camera.lens = Some(
        super::Lens::new(LensParams {
            blades: 6,
            swirl: 0.4,
            filters: crate::example::filter_stack(),
            prescription: Some(crate::example::double_gauss()),
            ..LensParams::default()
        })
        .unwrap(),
    );
    with_filters.camera.prepare_lens().unwrap();
    for scene in [scene, with_filters] {
        assert!(crate::render::camera_batches(&scene));
        let mut out = Vec::new();
        for index in [0u32, 1, 2, 17] {
            for y in 0..scene.render.height {
                let pixels: Vec<(u32, u32)> = (0..scene.render.width).map(|x| (x, y)).collect();
                camera_samples(&scene, &pixels, index, &mut out);
                assert_eq!(out.len(), pixels.len());
                for (&(x, y), got) in pixels.iter().zip(&out) {
                    let sampler = PixelSampler::new(scene.render.seed, x, y, index);
                    let want = camera_sample_filtered(&scene, &sampler, x, y);
                    let bits = |s: &crate::render::CameraSample| {
                        let (r, (u, v), w, p) = s;
                        (
                            [
                                r.origin.x, r.origin.y, r.origin.z, r.dir.x, r.dir.y, r.dir.z, *u,
                                *v,
                            ]
                            .map(f32::to_bits),
                            [w.r, w.g, w.b].map(f32::to_bits),
                            p.as_ref().map(|p| p.last.map(|l| l.0)),
                        )
                    };
                    assert_eq!(bits(got), bits(&want), "pixel ({x}, {y}), sample {index}");
                    assert_eq!(
                        got.3, want.3,
                        "the filters of pixel ({x}, {y}), sample {index}"
                    );
                }
            }
        }
    }
}

// --- O4: tilt and shift of a traced lens ----------------------------------------------------------

/// A lens of the catalogue tilted by `tilt` degrees about the axis `axis` degrees from the
/// camera's right, with the shift `shift` (mm), prepared for a 36 mm sensor.
fn tilted(key: &str, focal: f32, fstop: f32, focus: f32, tilt: f32, axis: f32) -> TracedLens {
    let lenses = catalogue();
    let (_, l) = lenses
        .iter()
        .find(|(k, _)| k == key)
        .expect("a catalogue lens");
    let params = LensParams {
        tilt_deg: tilt,
        tilt_axis_deg: axis,
        prescription: Some(prescription(l)),
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

/// The ray of `lens` from the sensor position `(x, y)` through the point `p` of its pupil (the
/// camera's lens-like frame: x right, y up, z back, the camera position at `(0, 0, pupil_z)`).
fn ray_of(lens: &TracedLens, x: f32, y: f32, p: (f32, f32)) -> (Vec3, Vec3) {
    match lens.chief(x, y, p) {
        Traced::Out { origin, dir } => (origin, dir),
        Traced::Blocked => panic!("blocked at ({x}, {y}) through {p:?}"),
    }
}

/// Where the rays of the sensor position `(x, y)` meet, as a distance along the chief ray from
/// the camera position: the mean of the two meridians (a lens's astigmatism splits them).
fn sharp_distance(lens: &TracedLens, x: f32, y: f32) -> f64 {
    let pivot = [0.0, 0.0, f64::from(lens.pupil_z())];
    let (_, chief) = ray_of(lens, x, y, (0.0, 0.0));
    let w = [f64::from(chief.x), f64::from(chief.y), f64::from(chief.z)];
    let mut sum = 0.0;
    for (a, b) in [((0.12, 0.0), (-0.12, 0.0)), ((0.0, 0.12), (0.0, -0.12))] {
        let (q, gap) = closest(ray_of(lens, x, y, a), ray_of(lens, x, y, b));
        assert!(
            gap < 1.5,
            "the rays of ({x}, {y}) miss each other by {gap} mm"
        );
        sum += (0..3).map(|i| (q[i] - pivot[i]) * w[i]).sum::<f64>();
    }
    0.5 * sum
}

/// Where the simple lens's plane of sharp focus (the hinge rule: through the focus point, normal
/// `f·forward + u·sin α·b`) meets the chief ray of `(x, y)`, as a distance from the camera position.
fn simple_lens_distance(
    lens: &TracedLens,
    x: f32,
    y: f32,
    focal: f64,
    focus: f64,
    tilt: f64,
    axis: f64,
) -> f64 {
    let (_, chief) = ray_of(lens, x, y, (0.0, 0.0));
    let w = [f64::from(chief.x), f64::from(chief.y), f64::from(chief.z)];
    let (sa, ca) = axis.to_radians().sin_cos();
    // forward (0, 0, −1) × a (ca, sa, 0) = (sa, −ca, 0).
    let b = [sa, -ca, 0.0];
    let s = tilt.to_radians().sin();
    let n = [b[0] * focus * s, b[1] * focus * s, -focal];
    // The plane through forward·u: n·(t w − u forward) = 0.
    let nw: f64 = (0..3).map(|i| n[i] * w[i]).sum();
    focus * focal / nw
}

#[test]
fn a_tilted_traced_lens_focuses_on_the_plane_of_the_simple_lens_of_the_same_tilt() {
    // O4: the lens turns until its plane of sharp focus leans as the simple lens's of the same
    // tilt, focal length and focus distance (paraxially), and the frame's centre is refocused with
    // real rays. The real rays of the centre meet at the focus distance; those of two points either
    // side of it across the tilt's axis meet where the simple lens's plane says plus what the
    // lens's own field curvature does at the same heights on its film (measured on the upright
    // lens): the tilt adds the plane, the lens keeps its character. The well-corrected macro lens
    // hardly curves its field: all nine points of its frame lie on the plane.
    for (key, focal, focus) in [
        ("double_gauss_normal", 50.0f32, 1500.0f32),
        ("telephoto_internal_focus", 85.0, 3000.0),
        ("macro_floating", 60.0, 600.0),
        ("triplet", 50.0, 2000.0),
    ] {
        for (tilt, axis) in [(5.0f32, 0.0f32), (-4.0, 90.0), (6.0, 30.0)] {
            let lens = tilted(key, focal, 8.0, focus, tilt, axis);
            let physical = lens.info().tilt_deg;
            assert!(
                physical.signum() == tilt.signum()
                    && (physical / tilt) > 0.5
                    && (physical / tilt) < 2.0,
                "{key}: tilted by {physical}° for {tilt}°"
            );
            let plane = |x: f32, y: f32, t: f32| {
                simple_lens_distance(
                    &lens,
                    x,
                    y,
                    f64::from(focal),
                    f64::from(focus),
                    f64::from(t),
                    f64::from(axis),
                )
            };
            let centre = sharp_distance(&lens, 0.0, 0.0);
            assert!(
                (centre - f64::from(focus)).abs() < 0.015 * f64::from(focus),
                "{key}, tilt {tilt}° about {axis}°: the centre is sharp at {centre:.1} mm, not {focus}"
            );
            // Across the axis, 4 mm either side of the centre on the sensor.
            let (sa, ca) = axis.to_radians().sin_cos();
            let (px, py) = (-4.0 * sa, 4.0 * ca);
            let got = sharp_distance(&lens, px, py) - sharp_distance(&lens, -px, -py);
            let want = plane(px, py, tilt) - plane(-px, -py, tilt);
            // The upright lens's own departure from its plane at the same heights on its film.
            let up = traced(key, focal, 8.0, focus);
            let dev = |x: f32, y: f32| {
                let f = lens.film_at(x, y);
                let (ux, uy) = (-f.x, -f.y);
                sharp_distance(&up, ux, uy)
                    - simple_lens_distance(
                        &up,
                        ux,
                        uy,
                        f64::from(focal),
                        f64::from(focus),
                        0.0,
                        0.0,
                    )
            };
            let curvature = dev(px, py) - dev(-px, -py);
            // The well-corrected lenses within a few percent; the telephoto and the triplet, whose
            // astigmatism off the axis this radial correction does not hold, within a fifth.
            let tolerance = if matches!(key, "macro_floating" | "double_gauss_normal") {
                0.035
            } else {
                0.2
            };
            let upright = plane(px, py, 0.0) - plane(-px, -py, 0.0);
            assert!(
                (got - want - curvature).abs() < tolerance * want.abs() && (want - upright).abs() > 0.05 * f64::from(focus),
                "{key}, tilt {tilt}° about {axis}°: the plane rises {got:.1} mm across 8 mm of the sensor, the simple lens's {want:.1} mm and the lens's own curvature {curvature:.1} (upright {upright:.1})"
            );
            if key == "macro_floating" {
                for (x, y) in [
                    (-12.0f32, -8.0f32),
                    (12.0, -8.0),
                    (-12.0, 8.0),
                    (12.0, 8.0),
                    (0.0, 8.0),
                    (0.0, -8.0),
                    (12.0, 0.0),
                    (-12.0, 0.0),
                ] {
                    let (got, want) = (sharp_distance(&lens, x, y), plane(x, y, tilt));
                    assert!(
                        (got - want).abs() < 0.025 * want,
                        "{key}, tilt {tilt}° about {axis}°: ({x}, {y}) sharp at {got:.1} mm, the plane is at {want:.1} mm"
                    );
                }
            }
        }
    }
}

#[test]
fn a_tilted_traced_lens_keeps_the_frame_on_the_focus_point() {
    // The sensor sits where the lens images the focus point: the frame's centre still looks at
    // it, and the frame does not swing with the tilt.
    for (tilt, axis) in [(8.0f32, 0.0f32), (-6.0, 90.0)] {
        let lens = tilted("double_gauss_normal", 50.0, 4.0, 1500.0, tilt, axis);
        let (o, d) = ray_of(&lens, 0.0, 0.0, (0.0, 0.0));
        let p0 = Vec3::new(0.0, 0.0, lens.pupil_z() - 1500.0);
        let to = p0 - o;
        let miss = (to - d * to.dot(d)).length();
        assert!(
            miss < 2.0,
            "tilt {tilt}°: the centre's chief ray passes {miss} mm from the focus point"
        );
        // A point of the frame looks where the upright lens's does, within a degree and a half.
        let (_, a) = ray_of(&lens, 10.0, 6.0, (0.0, 0.0));
        let (_, b) = ray_of(
            &traced("double_gauss_normal", 50.0, 4.0, 1500.0),
            10.0,
            6.0,
            (0.0, 0.0),
        );
        assert!(
            a.dot(b) > (1.5f32).to_radians().cos(),
            "tilt {tilt}°: {a:?} against {b:?}"
        );
    }
}

#[test]
fn a_traced_shift_moves_the_frame_by_its_millimetres_on_the_sensor() {
    // The shift is a sensor offset in the image plane: with a shift of (s_x, s_y) the point at
    // infinity on the axis lies at −(s_x, s_y) from the frame's centre, upright or tilted (where
    // the axis's point is the focus point), and the perspective does not change.
    use crate::scene::Camera;
    for (tilt, shift) in [
        (0.0f32, (5.0f32, -3.0f32)),
        (0.0, (0.0, 7.5)),
        (6.0, (4.0, 2.0)),
    ] {
        let mut camera = Camera {
            position: Vec3::new(0.0, -1500.0, 0.0),
            target: Vec3::ZERO,
            focal_mm: 50.0,
            fstop: 4.0,
            focus_dist: 1500.0,
            lens: Some(
                super::Lens::new(LensParams {
                    shift_x_mm: shift.0,
                    shift_y_mm: shift.1,
                    tilt_deg: tilt,
                    prescription: Some(crate::example::double_gauss()),
                    ..LensParams::default()
                })
                .unwrap(),
            ),
            ..Camera::default()
        };
        camera.prepare_lens().unwrap();
        let aspect = 4.0 / 3.0;
        let (w, h) = (36.0f32, 27.0f32);
        let (u, v) = (0.5 - shift.0 / w, 0.5 + shift.1 / h);
        let ray = camera.generate_ray(aspect, u, v, (0.0, 0.0));
        // The focus point (at infinity for the upright lens: along the view).
        let target = Vec3::new(0.0, 0.0, 0.0);
        let to = target - ray.origin;
        let miss = (to - ray.dir * to.dot(ray.dir)).length();
        assert!(
            miss < 3.0,
            "tilt {tilt}°, shift {shift:?}: the axis lands {miss} mm off"
        );
        // And one millimetre more of shift moves it one millimetre: the frame's other points too.
        let ray0 = camera.generate_ray(aspect, 0.5, 0.5, (0.0, 0.0));
        let to0 = target - ray0.origin;
        let off = (to0 - ray0.dir * to0.dot(ray0.dir)).length();
        if shift.0 != 0.0 || shift.1 != 0.0 {
            assert!(off > 20.0, "the shift moved nothing ({off} mm)");
        }
    }
}

#[test]
fn no_tilt_is_the_upright_lens_bit_for_bit() {
    // A tilt of 0 is no tilt whatever its axis: the samples and the chief rays carry the same
    // bits as a lens with neither.
    let plain = traced("double_gauss_normal", 50.0, 2.8, 1500.0);
    let axis = tilted("double_gauss_normal", 50.0, 2.8, 1500.0, 0.0, 37.0);
    assert_eq!(plain, axis);
    assert_eq!(plain.info().to_json(), axis.info().to_json());
    assert!(!plain.info().to_json().contains("tiltDeg"));
    assert!(tilted("double_gauss_normal", 50.0, 2.8, 1500.0, 3.0, 0.0)
        .info()
        .to_json()
        .contains("\"tiltDeg\":"));
}

#[test]
fn a_tilted_lens_batches_the_bits_of_its_samples_one_by_one_and_keeps_its_light() {
    let mut rng = crate::rng::Pcg32::seeded(5, 3);
    for (key, tilt, axis) in [
        ("double_gauss_normal", 6.0f32, 0.0f32),
        ("petzval_portrait", -5.0, 90.0),
        ("telephoto_internal_focus", 4.0, 45.0),
    ] {
        let lens = tilted(key, 50.0, 0.0, 1500.0, tilt, axis);
        for swirl in [0.0f32, 0.5] {
            for n in [1usize, 5, LANES] {
                for _ in 0..30 {
                    let samples: Vec<BatchSample> = (0..n)
                        .map(|_| BatchSample {
                            x: 36.0 * rng.next_f32() - 18.0,
                            y: 24.0 * rng.next_f32() - 12.0,
                            u: (rng.next_f32(), rng.next_f32()),
                            band: (rng.next_u32() % 3) as usize,
                        })
                        .collect();
                    let batch = lens.sample_batch(&samples, swirl);
                    for (k, s) in samples.iter().enumerate() {
                        assert_eq!(
                            sample_bits(batch[k]),
                            sample_bits(lens.sample(s.x, s.y, s.u, s.band, swirl)),
                            "{key}, lane {k} of {n}"
                        );
                    }
                }
            }
        }
        // Stopped down (wide open the beam of a point off the axis is clipped), the centre of the
        // frame gets about the light of the upright lens's centre: the tilted sensor's cosine and
        // the point off the lens's axis take a little.
        let lens = tilted(key, 50.0, 5.6, 1500.0, tilt, axis);
        let upright = traced(key, 50.0, 5.6, 1500.0);
        let mean = |l: &TracedLens| {
            let mut sum = 0.0f64;
            let n = 64;
            for j in 0..n {
                for i in 0..n {
                    let u = ((i as f32 + 0.5) / n as f32, (j as f32 + 0.5) / n as f32);
                    sum += f64::from(l.sample(0.0, 0.0, u, 1, 0.0).1);
                }
            }
            sum / f64::from(n * n)
        };
        let (a, b) = (mean(&lens), mean(&upright));
        assert!((a / b - 1.0).abs() < 0.06, "{key}: {a} against {b} upright");
    }
}

#[test]
fn a_traced_lens_with_cylinders_refuses_a_tilt() {
    let mut p = crate::example::double_gauss();
    p.surfaces[0].kind = SURFACE_CYLINDER_Y;
    let params = LensParams {
        tilt_deg: 4.0,
        prescription: Some(p),
        ..LensParams::default()
    };
    let got = TracedLens::new(
        params.prescription.as_ref().unwrap(),
        &params,
        CameraOptics {
            focal_mm: 50.0,
            fstop: 4.0,
            focus_dist: 2000.0,
            sensor_mm: 36.0,
        },
    );
    assert_eq!(
        got.err(),
        Some("a traced lens with cylinders does not tilt")
    );
}

#[test]
fn every_catalogue_lens_without_cylinders_tilts_and_says_by_how_much() {
    // O4: each lens of the catalogue that forms an image and has no cylinders prepares with a tilt
    // either way about any axis, turns by a few degrees for the simple lens's 5°, and keeps its
    // centre sharp at the focus distance; the anamorphic adapter (cylinders) is refused above.
    let mut checked = 0;
    for (key, json) in catalogue() {
        let cylinders = json
            .get("surfaces")
            .arr()
            .iter()
            .any(|s| s.get("kind").str() == Some("cylinder"));
        if key == "anamorphic_adapter_2x" || cylinders {
            continue;
        }
        for (tilt, axis) in [(5.0f32, 0.0f32), (-5.0, 60.0)] {
            let lens = tilted(&key, 50.0, 8.0, 2000.0, tilt, axis);
            let deg = lens.info().tilt_deg;
            assert!(
                deg.signum() == tilt.signum() && deg.abs() > 1.0 && deg.abs() < 20.0,
                "{key}: {deg}° for {tilt}°"
            );
            let centre = sharp_distance(&lens, 0.0, 0.0);
            assert!(
                (centre - 2000.0).abs() < 0.03 * 2000.0,
                "{key}, tilt {tilt}° about {axis}°: the centre is sharp at {centre:.0} mm"
            );
            checked += 1;
        }
    }
    assert!(checked >= 28, "{checked}");
}

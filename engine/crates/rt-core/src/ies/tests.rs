//! Tests of the IES reader and of the distribution it describes. The two profiles under
//! `tests/fixtures/ies/` were typed by hand (the page's tests read the same files); everything else
//! is built here from formulas, so the expected values do not come from the code under test.

use super::*;

/// The two hand-written profiles of the tests.
pub(crate) const DOWNLIGHT: &str =
    include_str!("../../../../../tests/fixtures/ies/downlight-symmetric.ies");
pub(crate) const WALL_WASHER: &str =
    include_str!("../../../../../tests/fixtures/ies/wall-washer.ies");

/// An IES file with the given angles and a candela function of `(γ, φ)` in degrees.
fn ies_text(vertical: &[f32], horizontal: &[f32], f: impl Fn(f32, f32) -> f32) -> String {
    let join = |v: &[f32]| {
        v.iter()
            .map(|x| format!("{x}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let mut text = String::from("IESNA:LM-63-2002\n[LUMINAIRE] generated\nTILT=NONE\n");
    text += &format!(
        "1 1000 1 {} {} 1 2 0 0 0\n1 1 10\n{}\n{}\n",
        vertical.len(),
        horizontal.len(),
        join(vertical),
        join(horizontal)
    );
    for &h in horizontal {
        let row: Vec<f32> = vertical.iter().map(|&v| f(v, h)).collect();
        text += &join(&row);
        text += "\n";
    }
    text
}

fn parse(text: &str) -> Result<IesProfile, IesError> {
    IesProfile::parse(text.as_bytes())
}

fn profile(text: &str) -> IesProfile {
    parse(text).expect("a valid profile")
}

/// Angles from `from` to `to` (inclusive) every `step` degrees.
fn angles(from: f32, to: f32, step: f32) -> Vec<f32> {
    let n = ((to - from) / step).round() as usize;
    (0..=n).map(|i| from + step * i as f32).collect()
}

/// A unit direction in the luminaire's frame at vertical angle `gamma` and horizontal angle `phi`.
fn direction(gamma: f32, phi: f32) -> Vec3 {
    let (g, p) = (gamma.to_radians(), phi.to_radians());
    Vec3::new(g.sin() * p.sin(), g.sin() * p.cos(), g.cos())
}

fn close(a: f32, b: f32, tolerance: f32) -> bool {
    (a - b).abs() <= tolerance
}

// --- The two hand-written files ---------------------------------------------------------------

#[test]
fn the_downlight_is_read_as_the_file_says() {
    let p = profile(DOWNLIGHT);
    assert_eq!(
        p.name(),
        "Test downlight, 1000 cd cos^2, rotationally symmetric"
    );
    assert_eq!(p.symmetry(), Symmetry::Rotational);
    assert_eq!(
        p.vertical_angles(),
        &[0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]
    );
    assert_eq!(p.horizontal_angles(), &[0.0]);
    assert_eq!(p.peak(), 1000.0);
    assert_eq!(p.candela_at(0, 3), Some(750.0));
    assert_eq!(p.candela_at(1, 0), None);
    assert_eq!(p.source(), DOWNLIGHT.as_bytes());
}

#[test]
fn the_downlight_intensity_at_0_30_and_60_degrees_is_the_files() {
    let p = profile(DOWNLIGHT);
    // 1000, 750 and 250 cd are table nodes: the interpolant must hit them to f32 round-off.
    for (gamma, candela) in [(0.0, 1000.0), (30.0, 750.0), (60.0, 250.0), (90.0, 0.0)] {
        assert!(
            close(p.intensity(gamma, 0.0), candela, 1.0e-3),
            "{gamma} degrees"
        );
        // Round the axis: rotationally symmetric, so φ does not matter.
        assert!(close(p.intensity(gamma, 123.0), candela, 1.0e-3));
        // Through a direction: the angles the luminaire sees from a unit vector.
        let d = p.intensity_dir(direction(gamma, 77.0));
        assert!(
            close(d, candela, 1.0e-4 * 1000.0),
            "{gamma} degrees by direction: {d}"
        );
    }
    // Between nodes it is linear: 35° is halfway from 750 to 587.
    assert!(close(p.intensity(35.0, 0.0), 668.5, 1.0e-3));
    // And it is 1000 cos² to the whole candela the file rounds to: the interpolation error against
    // the smooth function stays under one part in a hundred of the peak.
    for gamma in [5.0f32, 15.0, 25.0, 35.0, 45.0, 55.0, 65.0, 75.0, 85.0] {
        let exact = 1000.0 * gamma.to_radians().cos().powi(2);
        assert!(close(p.intensity(gamma, 0.0), exact, 10.0), "{gamma}");
    }
}

#[test]
fn nothing_is_sent_outside_the_vertical_range() {
    let p = profile(DOWNLIGHT);
    for gamma in [90.001, 95.0, 135.0, 180.0, -1.0, f32::NAN] {
        assert_eq!(p.intensity(gamma, 0.0), 0.0, "{gamma}");
    }
    assert_eq!(p.intensity_dir(Vec3::new(0.0, 0.0, -1.0)), 0.0);
    assert_eq!(p.intensity_dir(Vec3::new(1.0, 0.0, 0.0)), 0.0); // γ = 90° exactly: the file says 0
}

#[test]
fn the_wall_washer_is_read_and_follows_its_table() {
    let p = profile(WALL_WASHER);
    assert_eq!(
        p.name(),
        "Test wall washer, asymmetric (all 360 degrees given)"
    );
    assert_eq!(p.symmetry(), Symmetry::Full);
    assert_eq!(p.horizontal_angles(), &[0.0, 90.0, 180.0, 270.0, 360.0]);
    assert_eq!(p.peak(), 900.0);
    // Nodes.
    assert!(close(p.intensity(60.0, 0.0), 560.0, 1.0e-3));
    assert!(close(p.intensity(60.0, 90.0), 430.0, 1.0e-3));
    assert!(close(p.intensity(60.0, 180.0), 330.0, 1.0e-3));
    assert!(close(p.intensity(60.0, 270.0), 380.0, 1.0e-3));
    assert!(close(p.intensity(60.0, 360.0), 560.0, 1.0e-3));
    // 30° is not a vertical angle of the table: halfway from 860 to 740 along C0.
    assert!(close(p.intensity(30.0, 0.0), 800.0, 1.0e-3));
    // And bilinear: halfway between C0 (800) and C90 (halfway from 820 to 640 = 730) at 45°.
    assert!(close(p.intensity(30.0, 45.0), 765.0, 1.0e-3));
    // φ is any angle: 405° is 45°, -45° is 315° (halfway between C270 and C360).
    assert!(close(p.intensity(30.0, 405.0), 765.0, 1.0e-3));
    assert!(close(
        p.intensity(30.0, -45.0),
        0.5 * (800.0 + 0.5 * (800.0 + 600.0)),
        1.0e-3
    ));
}

#[test]
fn the_horizontal_angle_runs_from_plus_y_towards_plus_x() {
    // C90 is brighter than C270 in the wall washer: the side the angle turns towards (+x) is the
    // brighter, and C0 lies along +y.
    let p = profile(WALL_WASHER);
    let gamma = 60.0;
    assert!(close(p.intensity_dir(direction(gamma, 0.0)), 560.0, 0.05)); // +y side
    assert!(close(p.intensity_dir(direction(gamma, 90.0)), 430.0, 0.05)); // +x side
    assert!(close(p.intensity_dir(direction(gamma, 180.0)), 330.0, 0.05)); // -y side
    assert!(close(p.intensity_dir(direction(gamma, 270.0)), 380.0, 0.05)); // -x side
    let plus_x = Vec3::new(gamma.to_radians().sin(), 0.0, gamma.to_radians().cos());
    assert!(close(p.intensity_dir(plus_x), 430.0, 0.05));
    // On the axis every φ agrees.
    assert!(close(
        p.intensity_dir(Vec3::new(0.0, 0.0, 1.0)),
        900.0,
        1.0e-3
    ));
    // The share of the peak.
    assert!(close(p.shape(plus_x), 430.0 / 900.0, 1.0e-6));
    assert_eq!(p.shape(Vec3::new(0.0, 0.0, 1.0)), 1.0);
}

// --- Flux ---------------------------------------------------------------------------------------

#[test]
fn an_isotropic_profile_has_the_flux_of_a_sphere() {
    // 100 cd everywhere over 0-180° and one horizontal angle: Φ = 4π · 100 exactly, and a lamp as
    // bright in every direction as in its brightest has efficiency 1.
    let v = angles(0.0, 180.0, 10.0);
    let p = profile(&ies_text(&v, &[0.0], |_, _| 100.0));
    let exact = 4.0 * std::f32::consts::PI * 100.0;
    assert!(
        close(p.flux(), exact, exact * 2.0e-6),
        "{} against {exact}",
        p.flux()
    );
    assert!(close(p.efficiency(), 1.0, 2.0e-6));
    // The same with every kind of symmetry and an irregular grid of angles.
    let v = [0.0, 3.0, 17.0, 40.0, 41.0, 90.0, 120.0, 179.0, 180.0];
    for h in [
        vec![0.0],
        vec![0.0, 20.0, 90.0],
        vec![0.0, 70.0, 180.0],
        vec![90.0, 200.0, 270.0],
        vec![0.0, 100.0, 250.0, 360.0],
    ] {
        let p = profile(&ies_text(&v, &h, |_, _| 100.0));
        assert!(
            close(p.flux(), exact, exact * 4.0e-6),
            "{h:?}: {}",
            p.flux()
        );
    }
    // Half the sphere (0-90°): 2π · 100.
    let half = profile(&ies_text(&angles(0.0, 90.0, 15.0), &[0.0], |_, _| 100.0));
    assert!(close(
        half.flux(),
        2.0 * std::f32::consts::PI * 100.0,
        1.0e-3
    ));
    assert!(close(half.efficiency(), 0.5, 2.0e-6));
}

#[test]
fn the_flux_of_a_cosine_squared_lamp_is_2_pi_over_3_of_its_peak() {
    // ∫ 1000 cos²γ sinγ dΩ over the hemisphere = 2π · 1000 / 3. A table of 1° steps is a fine
    // piecewise-linear cos²: the interpolant is off by up to h²/8 · |f''| (h = 1° = 0.0175 rad,
    // |f''| ≤ 2) = 7.6e-5 of the peak, and what the integral keeps of that is h²/12 · |f''| over f,
    // about 5e-5 of the flux (the measured 5.07e-5): the test allows 1e-4.
    let exact = 2.0 * std::f32::consts::PI * 1000.0 / 3.0;
    let fine = profile(&ies_text(&angles(0.0, 90.0, 1.0), &[0.0], |g, _| {
        1000.0 * g.to_radians().cos().powi(2)
    }));
    assert!(
        close(fine.flux() / exact, 1.0, 1.0e-4),
        "{}",
        fine.flux() / exact
    );
    // The hand-written file has 10° steps, rounded to the candela: the interpolation error goes
    // with h², so ten times the step is a hundred times the error, 5e-3 (measured 4.98e-3); the
    // rounding of the values to the whole candela adds under 1e-3 of the flux.
    let coarse = profile(DOWNLIGHT);
    assert!(
        close(coarse.flux() / exact, 1.0, 6.0e-3),
        "{}",
        coarse.flux() / exact
    );
    assert!(close(
        coarse.efficiency(),
        exact / (4.0 * std::f32::consts::PI * 1000.0),
        1.2e-3
    ));
}

#[test]
fn the_flux_matches_a_numerical_integral_of_the_intensity() {
    // The closed form must be the integral of the interpolant the engine evaluates: a midpoint
    // quadrature of `intensity` over the sphere (1° in γ, 2° in φ) of the asymmetric file.
    let p = profile(WALL_WASHER);
    let (mut sum, dg, dp) = (0.0f64, 1.0f64, 2.0f64);
    let mut g = 0.5f64;
    while g < 180.0 {
        let mut f = 1.0f64;
        while f < 360.0 {
            sum += p.intensity(g as f32, f as f32) as f64
                * (g.to_radians()).sin()
                * dg.to_radians()
                * dp.to_radians();
            f += dp;
        }
        g += dg;
    }
    assert!(
        close(p.flux() / sum as f32, 1.0, 1.5e-3),
        "{} against {sum}",
        p.flux()
    );
}

// --- Symmetries ---------------------------------------------------------------------------------

#[test]
fn a_reduced_table_gives_what_the_full_one_does() {
    // One distribution, written under each symmetry and in full: they must agree at every
    // direction, φ included beyond the stored range, and in flux.
    let every = angles(0.0, 360.0, 30.0);
    let vertical = angles(0.0, 180.0, 15.0);
    type Distribution = fn(f32, f32) -> f32;
    let cases: [(&str, Vec<f32>, Distribution); 4] = [
        // Even in φ and in 180° - φ: a quadrant is enough.
        ("quadrant", angles(0.0, 90.0, 30.0), |g, p| {
            800.0 * (1.0 + 0.5 * (2.0 * p.to_radians()).cos()) * (1.0 + g.to_radians().cos())
        }),
        // Even in φ: the 0-180 plane is a mirror.
        ("bilateral 0-180", angles(0.0, 180.0, 30.0), |g, p| {
            500.0 * (1.0 + 0.3 * p.to_radians().cos()) * (1.0 + 0.5 * g.to_radians().cos())
        }),
        // Even about 90°: the 90-270 plane is a mirror.
        ("bilateral 90-270", angles(90.0, 270.0, 30.0), |g, p| {
            500.0 * (1.0 + 0.3 * p.to_radians().sin()) * (1.0 + 0.5 * g.to_radians().cos())
        }),
        ("rotational", vec![0.0], |g, _| {
            700.0 * (0.2 + g.to_radians().cos().abs())
        }),
    ];
    for (name, stored, f) in cases {
        let reduced = profile(&ies_text(&vertical, &stored, f));
        let full = profile(&ies_text(&vertical, &every, f));
        assert_ne!(reduced.symmetry(), Symmetry::Full, "{name}");
        assert_eq!(full.symmetry(), Symmetry::Full);
        for gamma in [0.0, 7.0, 44.0, 91.0, 133.0, 179.5] {
            for phi in [
                -400.0f32, -170.0, -90.0, -1.0, 0.0, 12.0, 45.0, 89.0, 90.0, 135.0, 179.0, 180.0,
                181.0, 225.0, 270.0, 300.0, 359.0, 360.0, 721.0,
            ] {
                let (a, b) = (reduced.intensity(gamma, phi), full.intensity(gamma, phi));
                assert!(
                    close(a, b, 1.0e-3 * 1000.0f32.max(b)),
                    "{name}: ({gamma}, {phi}): {a} against {b}"
                );
            }
        }
        assert!(
            close(reduced.flux() / full.flux(), 1.0, 1.0e-4),
            "{name}: {} against {}",
            reduced.flux(),
            full.flux()
        );
        assert_eq!(reduced.peak(), full.peak(), "{name}");
    }
}

#[test]
fn the_symmetries_are_told_by_the_horizontal_angles() {
    let v = [0.0, 90.0];
    let sym = |h: &[f32]| profile(&ies_text(&v, h, |_, _| 5.0)).symmetry();
    assert_eq!(sym(&[0.0]), Symmetry::Rotational);
    assert_eq!(sym(&[45.0]), Symmetry::Rotational);
    assert_eq!(sym(&[0.0, 90.0]), Symmetry::Quadrant);
    assert_eq!(sym(&[0.0, 45.0, 90.0]), Symmetry::Quadrant);
    assert_eq!(sym(&[0.0, 180.0]), Symmetry::Bilateral0);
    assert_eq!(sym(&[90.0, 270.0]), Symmetry::Bilateral90);
    assert_eq!(sym(&[0.0, 360.0]), Symmetry::Full);
}

// --- Malformed files ------------------------------------------------------------------------------

/// The downlight with one thing changed.
fn downlight_with(from: &str, to: &str) -> String {
    assert!(DOWNLIGHT.contains(from), "{from}");
    DOWNLIGHT.replacen(from, to, 1)
}

#[test]
fn a_cut_short_file_is_refused_with_the_numbers_it_has() {
    // Cut in the table, in the angles and in the header.
    let cut = downlight_with(
        "1000 970 883 750 587 413 250 117 30 0",
        "1000 970 883 750 587",
    );
    let err = parse(&cut).unwrap_err();
    assert_eq!(
        err,
        IesError::Truncated {
            expected: 34,
            found: 29
        }
    );
    assert!(
        err.to_string().contains("34") && err.to_string().contains("29"),
        "{err}"
    );
    let no_table = DOWNLIGHT.split("TILT=NONE").next().unwrap().to_string()
        + "TILT=NONE\n1 2094 1 10 1 1 2 0 0 0\n1 1 10\n0 10 20";
    assert!(matches!(
        parse(&no_table),
        Err(IesError::Truncated {
            expected: 34,
            found: 16
        })
    ));
    let short_header = DOWNLIGHT.split("TILT=NONE").next().unwrap().to_string()
        + "TILT=NONE\n1 2094 1 10 1 1 2 0 0";
    assert_eq!(parse(&short_header), Err(IesError::ShortHeader));
    let nothing = DOWNLIGHT.split("TILT=NONE").next().unwrap().to_string() + "TILT=NONE\n";
    assert_eq!(parse(&nothing), Err(IesError::ShortHeader));
}

#[test]
fn wrong_counts_are_refused_both_ways() {
    // Declares 11 vertical angles but gives 10: the table is one short (a count too large).
    let too_many_declared = downlight_with("1 2094 1 10 1 1 2", "1 2094 1 11 1 1 2");
    assert!(matches!(
        parse(&too_many_declared),
        Err(IesError::Truncated { .. })
    ));
    // Declares 9 and gives 10 angles: a number too many (a count too small).
    let too_few_declared = downlight_with("1 2094 1 10 1 1 2", "1 2094 1 9 1 1 2");
    assert!(matches!(
        parse(&too_few_declared),
        Err(IesError::TooManyValues { .. })
    ));
    // A value too many at the end.
    let extra = DOWNLIGHT.to_string() + "5\n";
    assert_eq!(
        parse(&extra),
        Err(IesError::TooManyValues {
            expected: 34,
            found: 35
        })
    );
    // A horizontal count that would need a gigantic table: refused before anything is allocated.
    let huge = downlight_with("1 2094 1 10 1 1 2", "1 2094 1 10 3000000 1 2");
    assert_eq!(parse(&huge), Err(IesError::TooManyAngles));
    // Counts that are not whole numbers of at least one.
    for bad in [
        "1 2094 1 10 0 1 2",
        "1 2094 1 0 1 1 2",
        "1 2094 1 10.5 1 1 2",
        "1 2094 1 -10 1 1 2",
        "1 2094 1 10 1.5 1 2",
    ] {
        assert_eq!(
            parse(&downlight_with("1 2094 1 10 1 1 2", bad)),
            Err(IesError::BadCount),
            "{bad}"
        );
    }
}

#[test]
fn negative_and_non_finite_values_are_refused() {
    let negative = downlight_with("1000 970 883", "1000 -970 883");
    assert_eq!(parse(&negative), Err(IesError::NegativeCandela));
    for bad in ["nan", "inf", "-inf", "1e999", "ten", "0x10", "1,,2z"] {
        let text = downlight_with("1000 970 883", &format!("1000 {bad} 883"));
        assert!(
            matches!(parse(&text), Err(IesError::NotANumber(_))),
            "{bad}: {:?}",
            parse(&text)
        );
    }
    // The position of the bad value is reported (counted from the first number after TILT=).
    let text = downlight_with("1000 970 883", "1000 xx 883");
    assert_eq!(parse(&text), Err(IesError::NotANumber(26)));
    // A multiplier that is not positive.
    assert_eq!(
        parse(&downlight_with("1 2094 1 10", "1 2094 0 10")),
        Err(IesError::BadMultiplier)
    );
    assert_eq!(
        parse(&downlight_with("1 2094 1 10", "1 2094 -1 10")),
        Err(IesError::BadMultiplier)
    );
    // A table with no light at all.
    let dark = downlight_with(
        "1000 970 883 750 587 413 250 117 30 0",
        "0 0 0 0 0 0 0 0 0 0",
    );
    assert_eq!(parse(&dark), Err(IesError::NoLight));
}

#[test]
fn angles_that_the_standard_does_not_allow_are_refused() {
    // Not increasing, repeated, out of order.
    for bad in [
        "0 10 20 30 40 50 60 70 80 80",
        "0 10 20 30 40 50 60 70 90 80",
        "0 10 10 30 40 50 60 70 80 90",
    ] {
        assert_eq!(
            parse(&downlight_with("0 10 20 30 40 50 60 70 80 90", bad)),
            Err(IesError::BadVerticalAngles),
            "{bad}"
        );
    }
    // A range that is none of 0-90, 0-180, 90-180.
    for bad in [
        "0 10 20 30 40 50 60 70 80 85",
        "5 10 20 30 40 50 60 70 80 90",
        "0 10 20 30 40 50 60 70 80 100",
    ] {
        assert_eq!(
            parse(&downlight_with("0 10 20 30 40 50 60 70 80 90", bad)),
            Err(IesError::BadVerticalAngles),
            "{bad}"
        );
    }
    // A single vertical angle is not a distribution.
    let one = ies_text(&[0.0], &[0.0], |_, _| 5.0);
    assert_eq!(parse(&one), Err(IesError::BadVerticalAngles));
    // Horizontal angles: 0-45 is not a symmetry of the standard; neither is a decreasing list.
    let v = [0.0, 90.0];
    assert_eq!(
        parse(&ies_text(&v, &[0.0, 45.0], |_, _| 5.0)),
        Err(IesError::BadHorizontalAngles)
    );
    assert_eq!(
        parse(&ies_text(&v, &[0.0, 180.0, 90.0], |_, _| 5.0)),
        Err(IesError::BadHorizontalAngles)
    );
    assert_eq!(
        parse(&ies_text(&v, &[0.0, 0.0], |_, _| 5.0)),
        Err(IesError::BadHorizontalAngles)
    );
    assert_eq!(
        parse(&ies_text(&v, &[400.0], |_, _| 5.0)),
        Err(IesError::BadHorizontalAngles)
    );
}

#[test]
fn tilt_and_photometric_type_are_refused_with_their_own_message() {
    let included = downlight_with("TILT=NONE", "TILT=INCLUDE");
    let err = parse(&included).unwrap_err();
    assert_eq!(err, IesError::TiltIncluded);
    assert!(
        err.to_string().contains("TILT=INCLUDE") && err.to_string().contains("TILT=NONE"),
        "{err}"
    );
    assert_eq!(
        parse(&downlight_with("TILT=NONE", "TILT=LAMP1.TLT")),
        Err(IesError::TiltFile)
    );
    assert_eq!(
        parse(&downlight_with("TILT=NONE\n", "")),
        Err(IesError::MissingTilt)
    );
    assert_eq!(parse(""), Err(IesError::MissingTilt));
    assert_eq!(
        parse("IESNA:LM-63-2002\n[TEST] only a header\n"),
        Err(IesError::MissingTilt)
    );
    let b = parse(&downlight_with("1 2094 1 10 1 1 2", "1 2094 1 10 1 2 2")).unwrap_err();
    assert_eq!(b, IesError::UnsupportedType(2));
    assert!(b.to_string().contains("type B"), "{b}");
    let a = parse(&downlight_with("1 2094 1 10 1 1 2", "1 2094 1 10 1 3 2")).unwrap_err();
    assert!(a.to_string().contains("type A"), "{a}");
    assert_eq!(
        parse(&downlight_with("1 2094 1 10 1 1 2", "1 2094 1 10 1 4 2")),
        Err(IesError::BadType)
    );
    assert_eq!(
        parse(&downlight_with("1 2094 1 10 1 1 2", "1 2094 1 10 1 0 2")),
        Err(IesError::BadType)
    );
}

#[test]
fn the_file_may_be_written_the_way_files_in_the_wild_are() {
    let reference = profile(DOWNLIGHT);
    // Windows line breaks, old Mac ones, a lower-case TILT, tabs and commas, extra blank lines.
    let crlf = DOWNLIGHT.replace('\n', "\r\n");
    assert_eq!(
        profile(&crlf).intensity(30.0, 0.0),
        reference.intensity(30.0, 0.0)
    );
    let cr = DOWNLIGHT.replace('\n', "\r");
    assert_eq!(
        profile(&cr).intensity(30.0, 0.0),
        reference.intensity(30.0, 0.0)
    );
    let lower = downlight_with("TILT=NONE", "tilt=none  ");
    assert_eq!(profile(&lower).flux(), reference.flux());
    let commas = downlight_with(
        "0 10 20 30 40 50 60 70 80 90",
        "0,\t10,20 ,30,40,50,60,70,80,90",
    );
    assert_eq!(profile(&commas).flux(), reference.flux());
    let spaced = DOWNLIGHT.replace("1 1 10\n", "\n\n1 1 10\n\n");
    assert_eq!(profile(&spaced).flux(), reference.flux());
    // Scientific notation and signs.
    let sci = downlight_with("1000 970", "1.0E+03 +9.7e2");
    assert_eq!(profile(&sci).candela_at(0, 1), Some(970.0));
    // A file of 1991, with no version line and a header of keywords only, and one with none.
    let old = DOWNLIGHT.replacen("IESNA:LM-63-2002\n", "", 1);
    assert_eq!(profile(&old).flux(), reference.flux());
    let bare = "TILT=NONE\n1 1000 1 2 1 1 2 0 0 0\n1 1 10\n0 90\n0\n100 100\n";
    assert_eq!(profile(bare).name(), "");
    assert_eq!(profile(bare).peak(), 100.0);
    // Bytes that are not text in the header (a Latin-1 degree sign) change nothing.
    let mut latin = DOWNLIGHT.as_bytes().to_vec();
    let at = latin.windows(6).position(|w| w == b"[LAMP]").unwrap();
    latin.splice(at + 7..at + 7, [0xb0u8, 0xff]);
    assert_eq!(IesProfile::parse(&latin).unwrap().flux(), reference.flux());
}

#[test]
fn the_multiplier_scales_the_candela_and_the_name_has_a_fallback() {
    let doubled = profile(&downlight_with("1 2094 1 10", "1 2094 2 10"));
    assert_eq!(doubled.peak(), 2000.0);
    assert_eq!(doubled.intensity(30.0, 0.0), 1500.0);
    let reference = profile(DOWNLIGHT);
    assert!(close(doubled.flux(), 2.0 * reference.flux(), 1.0e-3));
    // The shape (and so the picture) does not depend on it.
    assert!(close(doubled.efficiency(), reference.efficiency(), 1.0e-6));
    let no_name = downlight_with(
        "[LUMINAIRE] Test downlight, 1000 cd cos^2, rotationally symmetric\n",
        "",
    );
    assert_eq!(profile(&no_name).name(), "RS-DOWN-COS2");
    let only_test = no_name.replacen("[LUMCAT] RS-DOWN-COS2\n", "", 1);
    assert_eq!(profile(&only_test).name(), "RS-TEST-0001");
    let long = downlight_with(
        "[LUMINAIRE] Test",
        &format!("[LUMINAIRE] {}", "n".repeat(200)),
    );
    assert_eq!(profile(&long).name().len(), 80);
    // [MORE] continues the keyword before it.
    let more = downlight_with(
        "[LUMINAIRE] Test downlight,",
        "[LUMINAIRE] A\n[MORE] B\n[MORE] C\n[LUMCAT] x Test downlight,",
    );
    assert_eq!(profile(&more).name(), "A B C");
}

#[test]
fn a_file_of_more_than_the_limit_is_refused_before_it_is_read() {
    let huge = vec![b' '; MAX_BYTES + 1];
    assert_eq!(IesProfile::parse(&huge), Err(IesError::TooLarge));
    let mut at_the_limit = DOWNLIGHT.as_bytes().to_vec();
    at_the_limit.resize(MAX_BYTES, b' ');
    assert!(IesProfile::parse(&at_the_limit).is_ok());
}

#[test]
fn reading_is_the_same_every_time() {
    let a = profile(WALL_WASHER);
    let b = profile(WALL_WASHER);
    assert_eq!(a, b);
    assert_eq!(a.flux().to_bits(), b.flux().to_bits());
    // Garbage never panics: every prefix of both files, and bytes that are not text.
    for text in [DOWNLIGHT, WALL_WASHER] {
        for n in 0..text.len() {
            let _ = IesProfile::parse(&text.as_bytes()[..n]);
        }
    }
    let noise: Vec<u8> = (0..4000u32)
        .map(|i| (i.wrapping_mul(2654435761) >> 13) as u8)
        .collect();
    let _ = IesProfile::parse(&noise);
}

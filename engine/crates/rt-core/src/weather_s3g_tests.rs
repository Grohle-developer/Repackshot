//! S3g: the outline of a drop's cap (`outline_area`) and a hanging drop's contact line.

use super::*;

/// A cap of 2 mm and 60° on a surface of normal `n`.
fn frame(n: Vec3, shape: &DropShape) -> ShapeFrame {
    ShapeFrame::new(n, shape, 2.0, 60.0)
}

#[test]
fn the_outline_of_a_round_cap_and_of_a_sliding_one_is_the_contact_area() {
    let up = Vec3::new(0.0, 0.0, 1.0);
    let round = std::f32::consts::PI * 4.0;
    let a = outline_area(&frame(up, &DropShape::ROUND), &DropShape::ROUND, 7);
    assert!((a / round - 1.0).abs() < 1e-5, "{a}");
    // Stretched along its axis and thinner across, tapered: the same area (the steps keep it).
    let sliding = DropShape {
        axis: Vec3::new(1.0, 0.0, 0.0),
        aspect: 3.0,
        bulge: 0.4,
        taper: 0.4,
        ..DropShape::ROUND
    };
    let a = outline_area(&frame(up, &sliding), &sliding, 720);
    assert!((a / round - 1.0).abs() < 1e-3, "{a}");
    // A merge's outline spanning two drops: larger, and its neck takes from it.
    let merge = |neck: f32| DropShape {
        merge_axis: Vec3::new(0.0, 1.0, 0.0),
        merge_along: 1.6,
        merge_across: 0.8,
        neck,
        ..DropShape::ROUND
    };
    let a0 = outline_area(&frame(up, &merge(0.0)), &merge(0.0), 720);
    assert!((a0 / round - 1.28).abs() < 1e-3, "{a0}");
    let a1 = outline_area(&frame(up, &merge(0.5)), &merge(0.5), 720);
    assert!(a1 < a0, "{a1} vs {a0}");
}

#[test]
fn a_hanging_drop_keeps_its_contact_line_and_its_volume() {
    // Under a ceiling (its normal down, gravity along it), stretched and pinched: its outline is
    // the round one (its contact line stays where it is), point by point.
    let down = Vec3::new(0.0, 0.0, -1.0);
    let hanging = DropShape {
        sag: 0.9,
        pinch: 0.4,
        ..DropShape::ROUND
    };
    let f = frame(down, &hanging);
    for k in 0..16 {
        let phi = k as f32 * std::f32::consts::TAU / 16.0;
        let q = Vec3::new(phi.cos(), phi.sin(), 0.0) * 2.0;
        let p = shape_point(q, &f, &hanging);
        assert!((p - q).length() < 1e-5, "{q:?} → {p:?}");
    }
    let round = std::f32::consts::PI * 4.0;
    assert!((outline_area(&f, &hanging, 720) / round - 1.0).abs() < 1e-4);
    // Its stretch along gravity keeps the volume of a paraboloid cap: the integral of the area of
    // its slices along its height.
    let (b, c, kt) = hang_stretch(&hanging);
    let n = 4000;
    let mut v = 0.0f64;
    for i in 0..n {
        let t = (i as f64 + 0.5) / n as f64;
        let w = (1.0 - 4.0 * f64::from(c) * t * (1.0 - t)) * (1.0 + f64::from(b) * t);
        v += 2.0 * (1.0 - t) * w * w / n as f64;
    }
    assert!((v * f64::from(kt) - 1.0).abs() < 1e-4, "{v} × {kt}");
    // And it is longer along gravity than the round cap is tall.
    let tip = shape_point(down * f.h, &f, &hanging);
    assert!(tip.dot(down) > 1.3 * f.h, "{tip:?} vs {}", f.h);
}

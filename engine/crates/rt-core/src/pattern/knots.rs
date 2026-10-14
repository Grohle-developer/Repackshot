//! Knots of a wood (E6): where a branch crossed the trunk. A branch grows out of the pith, so in
//! the wood it is a cone along a line from the pith outwards, tilted up the trunk; a piece cut
//! from the trunk shows it wherever the cone crosses its surface (on both faces it goes through,
//! a little wider where it is farther from the pith). Not a decal: the knot is a part of the
//! wood's field, in the same frame as the rings (millimetres, the pith along `z`).
//!
//! * **Placement.** By hash of the material's seed, inside the piece's box in the wood frame:
//!   along its length and across its width at least a radius from the ends, at any depth. The
//!   branch is the line from the pith through that point; a candidate whose cone would come
//!   within a millimetre of an earlier knot inside the piece is tried elsewhere (32 tries in
//!   all), and one whose axis would meet the surface at less than 45° (axis against the local
//!   tangent plane, where it crosses the surface; or that would not cross it) is drawn again,
//!   at most 8 times, then dropped: a knot never touches another and never grazes (a long
//!   teardrop on a ball: at 30° the cone's rim still grazed a ball; at 60° a flat face, which
//!   sees its knots at 49° to 66° because the branches tilt up the trunk, lost some). A dropped
//!   knot stays dropped.
//! * **Around a knot.** The fibres and the rings flow around it as a potential flow around a
//!   cylinder: the coordinate across the flow `a` becomes `a (1 - R²/ρ²)` (so the fibres sweep
//!   round the knot and bunch on its sides), faded out from 1.5 to 3 radii; the rings bulge
//!   outwards around it by `0.35 R (R/ρ)²` with the same fade.
//! * **Inside.** The knot's own end grain: rings around the branch at three times the trunk's
//!   density, darker by `darkness` × 35 %, a bark pocket at its edge (0.5 mm, −50 %), a dish
//!   0.05 mm deep, rougher by 0.1; on knots 20 mm or wider, a radial crack from the centre (one
//!   line 0.3 mm wide, −20 %).
//!
//! `src/core/knots.ts` places the same knots for the interface (the Fast preview and the
//! inspector), with the same hash, the same order of tries and the same test of the surface.

use super::noise::hash01;
use crate::math::Vec3;

/// Largest number of knots of a piece.
pub const MAX_KNOTS: u32 = 12;
/// Tries to place one knot before giving up on it.
const TRIES: u32 = 32;
/// Salt of the knots' hashes (`hash01`'s third argument is `seed ^ SALT`).
const SALT: u32 = 0x4b4e_4f54; // "KNOT"
/// Smallest gap between two knots inside the piece, millimetres.
const GAP_MM: f32 = 1.0;
/// The flow around a knot fades out between these many radii from its axis.
const FADE: (f32, f32) = (1.5, 3.0);
/// The rings' bulge around a knot at its edge, in radii.
const BULGE: f32 = 0.35;
/// Times a knot is drawn again because its axis would meet the surface too obliquely.
const REDRAWS: u32 = 8;
/// The least sine of the angle between a knot's axis and the surface where it crosses it (45°).
pub const MIN_INCIDENCE: f32 = std::f32::consts::FRAC_1_SQRT_2;
/// Width of the bark pocket at a knot's edge, millimetres.
pub const BARK_MM: f32 = 0.5;
/// Depth of a knot's dish, millimetres.
pub const DISH_MM: f32 = 0.05;
/// Knots this wide or wider (millimetres, at the piece's middle) have a crack.
pub const CRACK_FROM_MM: f32 = 20.0;
/// Half the width of a crack, millimetres.
pub const CRACK_HALF_MM: f32 = 0.15;

/// What a recipe asks of its knots.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KnotSpec {
    /// How many (0 to [`MAX_KNOTS`]).
    pub count: u32,
    /// Diameter at the piece's middle, millimetres.
    pub diameter_mm: f32,
    /// Variation of the diameter, ± this fraction (0..1).
    pub variation: f32,
    /// Darkness, 0..1 (35 % darker at 1).
    pub darkness: f32,
    /// The material's seed.
    pub seed: u32,
}

/// One knot: a branch's cone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Knot {
    /// Where the branch leaves the pith (`x = y = 0`).
    pub origin: Vec3,
    /// Unit direction of the branch, outwards.
    pub axis: Vec3,
    /// Unit direction across the branch along the trunk (the direction the fibres flow).
    pub flow: Vec3,
    /// Unit direction across the branch and the flow.
    pub across: Vec3,
    /// Distance along the branch from the pith to the point it was placed at.
    pub middle: f32,
    /// Radius there, millimetres.
    pub radius: f32,
    /// Angle of its crack in the plane `(across, flow)`, if it has one.
    pub crack: Option<f32>,
}

impl Knot {
    /// The radius at distance `s` from the pith along the branch: a cone born half as thick as
    /// it is at the piece's middle.
    #[inline]
    pub fn radius_at(&self, s: f32) -> f32 {
        self.radius * (0.5 + 0.5 * s / self.middle)
    }
}

/// Where a point lies in a knot.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Inside {
    /// Index of the knot.
    pub knot: usize,
    /// Coordinates across the branch: along `across` and along `flow`, millimetres.
    pub a: f32,
    /// See `a`.
    pub b: f32,
    /// Distance from the branch's axis.
    pub rho: f32,
    /// The knot's radius there.
    pub radius: f32,
}

/// What the knots do at a point outside them: the point the rings and fibres are read at, and the
/// bulge of the rings there; or the knot it is in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Flow {
    /// Outside every knot.
    Around {
        /// The point displaced by the flow around the knots.
        point: Vec3,
        /// How far the rings are pushed outwards there, millimetres.
        bulge: f32,
    },
    /// Inside a knot.
    In(Inside),
}

/// The knots of a piece.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Knots {
    /// The knots, in the order they were placed.
    pub list: Vec<Knot>,
    /// Their darkness (the spec's).
    pub darkness: f32,
}

/// The parameter at which the line `o + t d` enters and leaves the box `centre ± half`, if it
/// crosses it.
fn clip(o: Vec3, d: Vec3, centre: Vec3, half: Vec3) -> Option<(f32, f32)> {
    let (mut t0, mut t1) = (f32::NEG_INFINITY, f32::INFINITY);
    for (o, d, c, h) in [
        (o.x, d.x, centre.x, half.x),
        (o.y, d.y, centre.y, half.y),
        (o.z, d.z, centre.z, half.z),
    ] {
        if d.abs() < 1.0e-12 {
            if (o - c).abs() > h {
                return None;
            }
            continue;
        }
        let (a, b) = ((c - h - o) / d, (c + h - o) / d);
        t0 = t0.max(a.min(b));
        t1 = t1.min(a.max(b));
    }
    (t0 <= t1).then_some((t0, t1))
}

/// Smallest distance between the segments `p0 p1` and `q0 q1`, and the parameters along each.
fn segment_gap(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3) -> (f32, f32, f32) {
    let (d1, d2, r) = (p1 - p0, q1 - q0, p0 - q0);
    let (a, e, f) = (d1.dot(d1), d2.dot(d2), d2.dot(r));
    let (c, b) = (d1.dot(r), d1.dot(d2));
    let denom = a * e - b * b;
    let mut s = if denom > 1.0e-9 {
        ((b * f - c * e) / denom).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let mut t = if e > 1.0e-12 { (b * s + f) / e } else { 0.0 };
    if t < 0.0 {
        t = 0.0;
        s = if a > 1.0e-12 {
            (-c / a).clamp(0.0, 1.0)
        } else {
            0.0
        };
    } else if t > 1.0 {
        t = 1.0;
        s = if a > 1.0e-12 {
            ((b - c) / a).clamp(0.0, 1.0)
        } else {
            0.0
        };
    }
    ((p0 + d1 * s - (q0 + d2 * t)).length(), s, t)
}

/// [`Knots::place`]'s test for a piece that is its box `centre ± half`: the faces the axis
/// enters and leaves by, at [`MIN_INCIDENCE`] or more.
pub fn meets_box(centre: Vec3, half: Vec3) -> impl Fn(&Knot, f32, f32) -> bool {
    move |k: &Knot, t0: f32, t1: f32| {
        [t0, t1].into_iter().all(|t| {
            let d = k.origin + k.axis * t - centre;
            let r = [d.x.abs() / half.x, d.y.abs() / half.y, d.z.abs() / half.z];
            let face = if r[0] >= r[1] && r[0] >= r[2] {
                k.axis.x
            } else if r[1] >= r[2] {
                k.axis.y
            } else {
                k.axis.z
            };
            face.abs() >= MIN_INCIDENCE
        })
    }
}

impl Knots {
    /// No knots.
    pub fn none() -> Knots {
        Knots::default()
    }

    /// True when there are none.
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    /// The knots of a piece whose box in the wood frame is `centre ± half` (millimetres).
    /// `meets(knot, t0, t1)` says whether a candidate's axis, inside the box between `origin +
    /// axis t0` and `origin + axis t1`, crosses the piece's surface, and only at
    /// [`MIN_INCIDENCE`] or more ([`meets_box`] for the box itself).
    pub fn place(
        spec: &KnotSpec,
        centre: Vec3,
        half: Vec3,
        mut meets: impl FnMut(&Knot, f32, f32) -> bool,
    ) -> Knots {
        let count = spec.count.min(MAX_KNOTS);
        let mut list: Vec<Knot> = Vec::new();
        // Each knot's segment inside the piece, and its largest radius there.
        let mut inside: Vec<(Vec3, Vec3, f32)> = Vec::new();
        let diameter = spec.diameter_mm;
        if count == 0 || !(diameter > 0.0 && diameter.is_finite()) || !half.is_finite() {
            return Knots::none();
        }
        let salt = spec.seed ^ SALT;
        for k in 0..count {
            let mut grazing = 0;
            for attempt in 0..TRIES {
                let id = (k * TRIES + attempt) as i32;
                let h = |channel: i32| hash01(id, channel, salt);
                let d = diameter * (1.0 + spec.variation.clamp(0.0, 1.0) * (2.0 * h(0) - 1.0));
                let r = 0.5 * d;
                let p = Vec3::new(
                    centre.x + (2.0 * h(2) - 1.0) * (half.x - r).max(0.0),
                    centre.y + (2.0 * h(3) - 1.0) * half.y,
                    centre.z + (2.0 * h(1) - 1.0) * (half.z - r).max(0.0),
                );
                let radial = Vec3::new(p.x, p.y, 0.0);
                let out = radial.length();
                if out <= 1.0e-3 {
                    continue;
                }
                // Up the trunk by 15 to 35 degrees, either way along z.
                let tilt = (15.0 + 20.0 * h(4)) * crate::fmath::DEG_TO_RAD;
                let up = if h(5) < 0.5 { -1.0 } else { 1.0 };
                let (sin, cos) = crate::fmath::sin_cos(tilt);
                let axis = radial * (cos / out) + Vec3::new(0.0, 0.0, up * sin);
                let middle = out / cos;
                let origin = p - axis * middle;
                let flow = (Vec3::new(0.0, 0.0, 1.0) - axis * axis.z).normalize();
                let across = axis.cross(flow);
                let knot = Knot {
                    origin,
                    axis,
                    flow,
                    across,
                    middle,
                    radius: r,
                    crack: (d >= CRACK_FROM_MM).then(|| h(6) * crate::fmath::TAU),
                };
                let Some((t0, t1)) = clip(origin, axis, centre, half) else {
                    continue;
                };
                let (a, b) = (origin + axis * t0, origin + axis * t1);
                let widest = knot.radius_at(t0.max(t1));
                let clear = inside
                    .iter()
                    .all(|&(c, e, w)| segment_gap(a, b, c, e).0 >= widest + w + GAP_MM);
                if !clear {
                    continue;
                }
                if !meets(&knot, t0, t1) {
                    grazing += 1;
                    if grazing > REDRAWS {
                        break;
                    }
                    continue;
                }
                list.push(knot);
                inside.push((a, b, widest));
                break;
            }
        }
        Knots {
            list,
            darkness: spec.darkness.clamp(0.0, 1.0),
        }
    }

    /// The knots' effect at `q`.
    pub fn flow(&self, q: Vec3) -> Flow {
        let mut point = q;
        let mut bulge = 0.0f32;
        for (i, k) in self.list.iter().enumerate() {
            let rel = q - k.origin;
            let s = rel.dot(k.axis);
            if s <= 0.0 {
                continue;
            }
            let (a, b) = (rel.dot(k.across), rel.dot(k.flow));
            let rho2 = a * a + b * b;
            let r = k.radius_at(s);
            if rho2 < r * r {
                return Flow::In(Inside {
                    knot: i,
                    a,
                    b,
                    rho: rho2.sqrt(),
                    radius: r,
                });
            }
            let reach = FADE.1 * r;
            if rho2 >= reach * reach {
                continue;
            }
            let rho = rho2.sqrt();
            let fade = 1.0 - super::wood::smoothstep(FADE.0 * r, reach, rho);
            let k2 = r * r / rho2;
            point += k.across * (-a * k2 * fade);
            bulge += BULGE * r * k2 * fade;
        }
        Flow::Around { point, bulge }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(count: u32, diameter_mm: f32) -> KnotSpec {
        KnotSpec {
            count,
            diameter_mm,
            variation: 0.3,
            darkness: 0.7,
            seed: 7,
        }
    }

    /// A pine board 400 x 120 x 20 mm in a wood frame with its pith 160 mm below and 70 mm aside.
    fn board() -> (Vec3, Vec3) {
        (Vec3::new(70.0, 160.0, 0.0), Vec3::new(60.0, 10.0, 200.0))
    }

    #[test]
    fn knots_are_placed_as_asked_inside_the_piece_and_never_overlap() {
        let (centre, half) = board();
        for (count, d) in [(1, 15.0), (4, 15.0), (6, 30.0), (12, 25.0)] {
            let knots = Knots::place(&spec(count, d), centre, half, meets_box(centre, half));
            assert_eq!(knots.list.len(), count as usize, "{count} of {d} mm");
            for k in &knots.list {
                assert!(
                    k.origin.x.abs() < 1.0e-3 && k.origin.y.abs() < 1.0e-3,
                    "from the pith"
                );
                assert!((k.axis.length() - 1.0).abs() < 1.0e-5);
                assert!(k.axis.dot(k.flow).abs() < 1.0e-5 && k.axis.dot(k.across).abs() < 1.0e-5);
                let mid = k.origin + k.axis * k.middle;
                let off = mid - centre;
                assert!(off.x.abs() <= half.x && off.y.abs() <= half.y + 1.0e-3);
                assert!(off.z.abs() <= half.z - k.radius + 1.0e-3);
                assert!((2.0 * k.radius / d - 1.0).abs() <= 0.3 + 1.0e-5);
                assert_eq!(k.crack.is_some(), 2.0 * k.radius >= CRACK_FROM_MM);
            }
            // No point is inside two knots: sample the piece densely.
            for i in 0..60_000 {
                let u = |c: i32| hash01(i, c, 99) * 2.0 - 1.0;
                let q = centre + Vec3::new(u(0) * half.x, u(1) * half.y, u(2) * half.z);
                let hits = knots
                    .list
                    .iter()
                    .filter(|k| {
                        let rel = q - k.origin;
                        let s = rel.dot(k.axis);
                        let (a, b) = (rel.dot(k.across), rel.dot(k.flow));
                        s > 0.0 && a * a + b * b < k.radius_at(s).powi(2)
                    })
                    .count();
                assert!(hits <= 1, "{count} of {d} mm: {q:?}");
            }
        }
    }

    #[test]
    fn the_seed_moves_the_knots_and_the_same_seed_keeps_them() {
        let (centre, half) = board();
        let a = Knots::place(&spec(5, 18.0), centre, half, meets_box(centre, half));
        assert_eq!(
            a,
            Knots::place(&spec(5, 18.0), centre, half, meets_box(centre, half))
        );
        let b = Knots::place(
            &KnotSpec {
                seed: 8,
                ..spec(5, 18.0)
            },
            centre,
            half,
            meets_box(centre, half),
        );
        assert_ne!(a, b);
        // More knots keep the first ones where they were.
        let more = Knots::place(&spec(7, 18.0), centre, half, meets_box(centre, half));
        assert_eq!(more.list[..5], a.list[..]);
        assert!(Knots::place(&spec(0, 18.0), centre, half, meets_box(centre, half)).is_empty());
        assert!(Knots::place(&spec(5, 0.0), centre, half, meets_box(centre, half)).is_empty());
    }

    #[test]
    fn the_fibres_flow_around_a_knot_and_are_untouched_far_from_it() {
        let (centre, half) = board();
        let knots = Knots::place(&spec(1, 20.0), centre, half, meets_box(centre, half));
        let k = knots.list[0];
        let mid = k.origin + k.axis * k.middle;
        // Beside the knot across the flow (just outside its edge): pulled towards the line
        // through its middle, the fibres bunch there.
        let side = mid + k.across * (1.2 * k.radius);
        match knots.flow(side) {
            Flow::Around { point, bulge } => {
                let a = (point - k.origin).dot(k.across);
                assert!(a > 0.0 && a < 0.5 * k.radius, "{a}");
                assert!(bulge > 0.2 * k.radius);
            }
            Flow::In(_) => panic!("outside"),
        }
        // Up and down the flow, nothing moves across it.
        let ahead = mid + k.flow * (1.5 * k.radius);
        if let Flow::Around { point, .. } = knots.flow(ahead) {
            assert!((point - ahead).dot(k.across).abs() < 1.0e-4);
        }
        // In it.
        assert!(matches!(knots.flow(mid), Flow::In(Inside { knot: 0, .. })));
        // The flow fades out smoothly before it stops.
        let edge = mid + k.across * (2.99 * k.radius);
        if let Flow::Around { point, bulge } = knots.flow(edge) {
            assert!((point - edge).length() < 1.0e-3 * k.radius && bulge < 1.0e-3 * k.radius);
        }
        // Three radii away, exactly nothing.
        let far = mid + k.across * (3.01 * k.radius);
        assert_eq!(
            knots.flow(far),
            Flow::Around {
                point: far,
                bulge: 0.0
            }
        );
    }

    #[test]
    fn a_knot_never_meets_the_surface_obliquely_and_a_dropped_one_stays_dropped() {
        let (centre, half) = board();
        // Every knot placed crosses the board's faces at 30° or more.
        let knots = Knots::place(&spec(12, 15.0), centre, half, meets_box(centre, half));
        for k in &knots.list {
            let (t0, t1) = clip(k.origin, k.axis, centre, half).expect("in the board");
            assert!(meets_box(centre, half)(k, t0, t1));
        }
        // A surface every axis grazes: none is placed, each after its 9 draws.
        let mut asked = 0;
        let none = Knots::place(&spec(4, 15.0), centre, half, |_, _, _| {
            asked += 1;
            false
        });
        assert!(none.is_empty());
        assert_eq!(asked, 4 * 9);
        // The first knot's nine draws all graze: it is dropped, and the other two are placed
        // without anyone taking its place.
        let mut calls = 0;
        let without = Knots::place(&spec(3, 15.0), centre, half, |k, t0, t1| {
            calls += 1;
            calls > 9 && meets_box(centre, half)(k, t0, t1)
        });
        assert_eq!(without.list.len(), 2);
    }

    #[test]
    fn the_placement_is_pinned_for_the_preview() {
        // src/core/knots.ts places the same knots (tests/patterns.test.ts pins the same numbers).
        let (centre, half) = board();
        let knots = Knots::place(&spec(4, 17.5), centre, half, meets_box(centre, half));
        assert_eq!(knots.list.len(), PINNED_KNOTS.len());
        for (k, pinned) in knots.list.iter().zip(PINNED_KNOTS) {
            let mid = k.origin + k.axis * k.middle;
            let want = Vec3::new(pinned[0], pinned[1], pinned[2]);
            assert!((mid - want).length() < 1.0e-3, "{mid:?}");
            assert!((k.radius - pinned[3]).abs() < 1.0e-4, "{}", k.radius);
        }
    }

    /// The knots of `spec(4, 17.5)` in `board()`: their middles and radii.
    const PINNED_KNOTS: [[f32; 4]; 4] = [
        [51.081, 154.164, -45.991, 9.3261],
        [103.234, 169.191, -82.813, 10.2775],
        [61.512, 158.414, 21.696, 7.2598],
        [44.389, 161.345, -18.294, 9.2944],
    ];

    #[test]
    fn a_knot_is_wider_where_it_leaves_the_piece_farther_from_the_pith() {
        let (centre, half) = board();
        let knots = Knots::place(&spec(1, 16.0), centre, half, meets_box(centre, half));
        let k = knots.list[0];
        let (t0, t1) = clip(k.origin, k.axis, centre, half).expect("it crosses the piece");
        let (near, far) = (k.radius_at(t0), k.radius_at(t1));
        assert!(far > near && far / near < 1.4, "{near} {far}");
    }
}

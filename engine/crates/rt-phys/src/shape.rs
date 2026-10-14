//! The shape of a dynamic body: a sphere when the points are on one (a tessellated ball is a ball,
//! so it rests at its radius and rolls), otherwise the convex hull of the points (or its oriented
//! box), always expressed about the body's centre of mass.

use crate::hull::{Hull, HullKind};
use crate::math::{above, Mat3, Quat};
use rt_core::math::Vec3;

/// A body's collision shape, about its centre of mass.
#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    /// A ball.
    Sphere {
        /// mm.
        radius: f32,
    },
    /// A convex polyhedron.
    Hull(Hull),
}

/// What a body's shape was made from (for the interface and the tests).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeKind {
    /// The points lie on a sphere.
    Sphere,
    /// Their convex hull.
    Hull,
    /// Their oriented box (a flat cloud, or a hull over the vertex cap).
    OrientedBox,
}

/// Points are on a sphere when every distance to the centre is within this fraction of the mean.
const SPHERE_TOLERANCE: f32 = 2e-3;
/// A sphere needs at least this many distinct points (an octahedron is not a ball).
const SPHERE_MIN_POINTS: usize = 26;

/// A shape and its mass properties for unit density, built from world-space points.
#[derive(Clone, Debug)]
pub struct BuiltShape {
    /// The shape about its centre of mass (world axes).
    pub shape: Shape,
    /// What it was made from.
    pub kind: ShapeKind,
    /// The centre of mass in the world.
    pub center: Vec3,
    /// mm³.
    pub volume: f32,
    /// Inertia for unit density about the centre (world axes).
    pub inertia: Mat3,
}

/// The sphere through `points`, when they are on one: its centre and radius.
fn as_sphere(points: &[Vec3]) -> Option<(Vec3, f32)> {
    if points.len() < SPHERE_MIN_POINTS {
        return None;
    }
    let mut lo = points[0];
    let mut hi = points[0];
    for p in points {
        lo = lo.min(*p);
        hi = hi.max(*p);
    }
    let size = hi - lo;
    // A ball's box is a cube.
    let max = size.max_component();
    if !above(max, 0.0) || size.min_component() < max * (1.0 - 4.0 * SPHERE_TOLERANCE) {
        return None;
    }
    let c = (lo + hi) * 0.5;
    let mut sum = 0.0f32;
    for p in points {
        sum += (*p - c).length();
    }
    let r = sum / points.len() as f32;
    if !above(r, 0.0) {
        return None;
    }
    for p in points {
        if ((*p - c).length() - r).abs() > SPHERE_TOLERANCE * r {
            return None;
        }
    }
    Some((c, r))
}

impl BuiltShape {
    /// The shape of the world-space `points`. `min_thickness` is the thinnest box a flat part
    /// gets.
    pub fn from_points(points: &[Vec3], min_thickness: f32) -> BuiltShape {
        if let Some((center, radius)) = as_sphere(points) {
            let volume = 4.0 / 3.0 * std::f32::consts::PI * radius * radius * radius;
            let i = 0.4 * volume * radius * radius;
            return BuiltShape {
                shape: Shape::Sphere { radius },
                kind: ShapeKind::Sphere,
                center,
                volume,
                inertia: Mat3::diagonal(Vec3::splat(i)),
            };
        }
        let (hull, kind) = Hull::build(points, min_thickness);
        let mass = hull.mass_properties();
        BuiltShape {
            shape: Shape::Hull(hull.recentred(mass.center)),
            kind: match kind {
                HullKind::Hull => ShapeKind::Hull,
                HullKind::OrientedBox => ShapeKind::OrientedBox,
            },
            center: mass.center,
            volume: mass.volume,
            inertia: mass.inertia,
        }
    }

    /// A ball of `radius` at `center`.
    pub fn sphere(center: Vec3, radius: f32) -> BuiltShape {
        let volume = 4.0 / 3.0 * std::f32::consts::PI * radius * radius * radius;
        BuiltShape {
            shape: Shape::Sphere { radius },
            kind: ShapeKind::Sphere,
            center,
            volume,
            inertia: Mat3::diagonal(Vec3::splat(0.4 * volume * radius * radius)),
        }
    }
}

impl Shape {
    /// Distance from the centre of mass to the farthest point of the shape.
    pub fn radius(&self) -> f32 {
        match self {
            Shape::Sphere { radius } => *radius,
            Shape::Hull(h) => h.radius(),
        }
    }
}

/// A hull placed in the world for one step of collision detection: vertices, face planes and edge
/// directions in world space.
#[derive(Clone, Debug, Default)]
pub struct WorldHull {
    /// World vertices.
    pub verts: Vec<Vec3>,
    /// World face normals.
    pub normals: Vec<Vec3>,
    /// World face offsets.
    pub offsets: Vec<f32>,
    /// The body's centre of mass.
    pub center: Vec3,
}

impl WorldHull {
    /// Places `hull` with the rotation `q` and the centre `x`.
    pub fn place(&mut self, hull: &Hull, x: Vec3, q: Quat) {
        self.verts.clear();
        self.normals.clear();
        self.offsets.clear();
        for v in &hull.vertices {
            self.verts.push(x + q.rotate(*v));
        }
        for (f, n) in hull.normals.iter().enumerate() {
            let wn = q.rotate(*n);
            self.normals.push(wn);
            // A point of the face, moved: n·p changes by n'·x.
            self.offsets.push(hull.offsets[f] + wn.dot(x));
        }
        self.center = x;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ball(r: f32, c: Vec3, rings: usize, segs: usize) -> Vec<Vec3> {
        let mut pts = vec![c + Vec3::new(0.0, 0.0, r), c - Vec3::new(0.0, 0.0, r)];
        for i in 1..rings {
            let th = std::f32::consts::PI * i as f32 / rings as f32;
            for s in 0..segs {
                let ph = 2.0 * std::f32::consts::PI * s as f32 / segs as f32;
                pts.push(c + Vec3::new(th.sin() * ph.cos(), th.sin() * ph.sin(), th.cos()) * r);
            }
        }
        pts
    }

    #[test]
    fn a_tessellated_ball_is_a_sphere() {
        let b = BuiltShape::from_points(&ball(25.0, Vec3::new(1.0, 2.0, 3.0), 16, 32), 1.0);
        assert_eq!(b.kind, ShapeKind::Sphere);
        assert!((b.center - Vec3::new(1.0, 2.0, 3.0)).length() < 1e-3);
        assert!((b.shape.radius() - 25.0).abs() < 1e-3);
        // A squashed ball (an ellipsoid) is not.
        let flat: Vec<Vec3> = ball(25.0, Vec3::ZERO, 16, 32)
            .into_iter()
            .map(|p| Vec3::new(p.x, p.y, p.z * 0.5))
            .collect();
        assert_ne!(BuiltShape::from_points(&flat, 1.0).kind, ShapeKind::Sphere);
        // Nor is a cube's eight corners, or a ring.
        let ring: Vec<Vec3> = (0..64)
            .map(|s| {
                let ph = 2.0 * std::f32::consts::PI * s as f32 / 64.0;
                Vec3::new(ph.cos(), ph.sin(), 0.0) * 20.0
            })
            .collect();
        assert_ne!(BuiltShape::from_points(&ring, 1.0).kind, ShapeKind::Sphere);
    }

    #[test]
    fn a_box_is_a_hull_about_its_centre() {
        let mut pts = Vec::new();
        for i in 0..8 {
            pts.push(Vec3::new(
                if i & 1 != 0 { 110.0 } else { 90.0 },
                if i & 2 != 0 { 5.0 } else { -5.0 },
                if i & 4 != 0 { 40.0 } else { 0.0 },
            ));
        }
        let b = BuiltShape::from_points(&pts, 1.0);
        assert_eq!(b.kind, ShapeKind::Hull);
        assert!((b.center - Vec3::new(100.0, 0.0, 20.0)).length() < 1e-3);
        assert!((b.volume - 20.0 * 10.0 * 40.0).abs() < 1e-2);
        match &b.shape {
            Shape::Hull(h) => {
                let mut c = Vec3::ZERO;
                for v in &h.vertices {
                    c += *v;
                }
                assert!(c.length() < 1e-3, "recentred");
            }
            Shape::Sphere { .. } => panic!("a box"),
        }
    }
}

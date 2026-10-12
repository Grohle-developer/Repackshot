//! Vector maths, rays and axis-aligned bounding boxes. Everything is `f32`.

use std::ops::{Add, AddAssign, Div, Index, Mul, MulAssign, Neg, Sub, SubAssign};

/// A three component vector, used for points, directions and normals.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    /// X component.
    pub x: f32,
    /// Y component.
    pub y: f32,
    /// Z component.
    pub z: f32,
}

impl Vec3 {
    /// The zero vector.
    pub const ZERO: Vec3 = Vec3::new(0.0, 0.0, 0.0);
    /// The vector with every component equal to one.
    pub const ONE: Vec3 = Vec3::new(1.0, 1.0, 1.0);

    /// Creates a vector from its components.
    #[inline]
    pub const fn new(x: f32, y: f32, z: f32) -> Vec3 {
        Vec3 { x, y, z }
    }

    /// Creates a vector with the same value in every component.
    #[inline]
    pub const fn splat(v: f32) -> Vec3 {
        Vec3::new(v, v, v)
    }

    /// Dot product.
    #[inline]
    pub fn dot(self, o: Vec3) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    /// Cross product (right handed).
    #[inline]
    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    /// Squared Euclidean length.
    #[inline]
    pub fn length_squared(self) -> f32 {
        self.dot(self)
    }

    /// Euclidean length.
    #[inline]
    pub fn length(self) -> f32 {
        self.length_squared().sqrt()
    }

    /// Unit vector in the same direction. The zero (or non-finite) vector is returned unchanged
    /// instead of producing NaNs.
    #[inline]
    pub fn normalize(self) -> Vec3 {
        let len = self.length();
        if len > 0.0 && len.is_finite() {
            self / len
        } else {
            self
        }
    }

    /// Component-wise minimum.
    #[inline]
    pub fn min(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x.min(o.x), self.y.min(o.y), self.z.min(o.z))
    }

    /// Component-wise maximum.
    #[inline]
    pub fn max(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x.max(o.x), self.y.max(o.y), self.z.max(o.z))
    }

    /// Smallest component.
    #[inline]
    pub fn min_component(self) -> f32 {
        self.x.min(self.y).min(self.z)
    }

    /// Largest component.
    #[inline]
    pub fn max_component(self) -> f32 {
        self.x.max(self.y).max(self.z)
    }

    /// Component-wise absolute value.
    #[inline]
    pub fn abs(self) -> Vec3 {
        Vec3::new(self.x.abs(), self.y.abs(), self.z.abs())
    }

    /// Linear interpolation: `self` at `t = 0`, `o` at `t = 1`.
    #[inline]
    pub fn lerp(self, o: Vec3, t: f32) -> Vec3 {
        self + (o - self) * t
    }

    /// True when every component is finite (neither NaN nor infinite).
    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }

    /// Component-wise reciprocal, used to precompute the inverse ray direction.
    #[inline]
    pub fn recip(self) -> Vec3 {
        Vec3::new(1.0 / self.x, 1.0 / self.y, 1.0 / self.z)
    }
}

impl Add for Vec3 {
    type Output = Vec3;
    #[inline]
    fn add(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl Sub for Vec3 {
    type Output = Vec3;
    #[inline]
    fn sub(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

/// Component-wise product.
impl Mul for Vec3 {
    type Output = Vec3;
    #[inline]
    fn mul(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x * o.x, self.y * o.y, self.z * o.z)
    }
}

impl Mul<f32> for Vec3 {
    type Output = Vec3;
    #[inline]
    fn mul(self, s: f32) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }
}

impl Mul<Vec3> for f32 {
    type Output = Vec3;
    #[inline]
    fn mul(self, v: Vec3) -> Vec3 {
        v * self
    }
}

impl Div<f32> for Vec3 {
    type Output = Vec3;
    #[inline]
    fn div(self, s: f32) -> Vec3 {
        Vec3::new(self.x / s, self.y / s, self.z / s)
    }
}

impl Neg for Vec3 {
    type Output = Vec3;
    #[inline]
    fn neg(self) -> Vec3 {
        Vec3::new(-self.x, -self.y, -self.z)
    }
}

impl AddAssign for Vec3 {
    #[inline]
    fn add_assign(&mut self, o: Vec3) {
        *self = *self + o;
    }
}

impl SubAssign for Vec3 {
    #[inline]
    fn sub_assign(&mut self, o: Vec3) {
        *self = *self - o;
    }
}

impl MulAssign<f32> for Vec3 {
    #[inline]
    fn mul_assign(&mut self, s: f32) {
        *self = *self * s;
    }
}

/// Indexes the components: 0 is x, 1 is y, anything else is z.
impl Index<usize> for Vec3 {
    type Output = f32;
    #[inline]
    fn index(&self, i: usize) -> &f32 {
        match i {
            0 => &self.x,
            1 => &self.y,
            _ => &self.z,
        }
    }
}

/// A ray with a valid parameter interval `[t_min, t_max]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ray {
    /// Origin of the ray.
    pub origin: Vec3,
    /// Direction of the ray (not required to be normalised by the maths in this module).
    pub dir: Vec3,
    /// Smallest accepted parameter value.
    pub t_min: f32,
    /// Largest accepted parameter value.
    pub t_max: f32,
}

impl Ray {
    /// Smallest parameter accepted by [`Ray::new`], in scene units (millimetres).
    pub const EPSILON: f32 = 1.0e-3;

    /// Creates a ray over `[EPSILON, +inf)`.
    #[inline]
    pub fn new(origin: Vec3, dir: Vec3) -> Ray {
        Ray {
            origin,
            dir,
            t_min: Ray::EPSILON,
            t_max: f32::INFINITY,
        }
    }

    /// Point at parameter `t`: `origin + dir * t`.
    #[inline]
    pub fn at(&self, t: f32) -> Vec3 {
        self.origin + self.dir * t
    }
}

/// An axis-aligned bounding box.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    /// Corner with the smallest coordinates.
    pub min: Vec3,
    /// Corner with the largest coordinates.
    pub max: Vec3,
}

/// The default box is [`Aabb::EMPTY`].
impl Default for Aabb {
    fn default() -> Aabb {
        Aabb::EMPTY
    }
}

impl Aabb {
    /// The empty box: the identity of [`Aabb::union`] and [`Aabb::extend`].
    pub const EMPTY: Aabb = Aabb {
        min: Vec3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY),
        max: Vec3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY),
    };

    /// Creates a box from two corners.
    #[inline]
    pub fn new(min: Vec3, max: Vec3) -> Aabb {
        Aabb { min, max }
    }

    /// True when the box contains no point.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.min.x > self.max.x || self.min.y > self.max.y || self.min.z > self.max.z
    }

    /// Smallest box containing both boxes.
    #[inline]
    pub fn union(self, o: Aabb) -> Aabb {
        Aabb {
            min: self.min.min(o.min),
            max: self.max.max(o.max),
        }
    }

    /// Smallest box containing this box and `p`.
    #[inline]
    pub fn extend(self, p: Vec3) -> Aabb {
        Aabb {
            min: self.min.min(p),
            max: self.max.max(p),
        }
    }

    /// Centre of the box.
    #[inline]
    pub fn centroid(&self) -> Vec3 {
        (self.min + self.max) * 0.5
    }

    /// Total surface area; zero for an empty box.
    #[inline]
    pub fn surface_area(&self) -> f32 {
        if self.is_empty() {
            return 0.0;
        }
        let d = self.max - self.min;
        2.0 * (d.x * d.y + d.y * d.z + d.z * d.x)
    }

    /// Slab test. `inv_dir` is `ray.dir.recip()`, precomputed by the caller.
    ///
    /// Returns the parameter interval `(near, far)` where the ray is inside the box, clipped to
    /// `[ray.t_min, ray.t_max]`, or `None` when the ray misses. An axis on which the ray is
    /// parallel to the slab and lies exactly on its boundary imposes no constraint.
    #[inline]
    pub fn intersect(&self, ray: &Ray, inv_dir: Vec3) -> Option<(f32, f32)> {
        let mut near = ray.t_min;
        let mut far = ray.t_max;
        for axis in 0..3 {
            let a = (self.min[axis] - ray.origin[axis]) * inv_dir[axis];
            let b = (self.max[axis] - ray.origin[axis]) * inv_dir[axis];
            // `0 * inf` gives NaN: the ray is parallel to the slab and touches its boundary.
            if a.is_nan() || b.is_nan() {
                continue;
            }
            near = near.max(a.min(b));
            far = far.min(a.max(b));
        }
        // `near == +inf` happens for a ray parallel to a slab and outside of it; with an infinite
        // `t_max` that would otherwise pass the comparison below.
        if near <= far && near < f32::INFINITY {
            Some((near, far))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1.0e-5
    }

    #[test]
    fn vec3_operators() {
        let a = Vec3::new(1.0, 2.0, 3.0);
        let b = Vec3::new(4.0, -5.0, 6.0);
        assert_eq!(a + b, Vec3::new(5.0, -3.0, 9.0));
        assert_eq!(a - b, Vec3::new(-3.0, 7.0, -3.0));
        assert_eq!(a * b, Vec3::new(4.0, -10.0, 18.0));
        assert_eq!(a * 2.0, Vec3::new(2.0, 4.0, 6.0));
        assert_eq!(2.0 * a, Vec3::new(2.0, 4.0, 6.0));
        assert_eq!(a / 2.0, Vec3::new(0.5, 1.0, 1.5));
        assert_eq!(-a, Vec3::new(-1.0, -2.0, -3.0));
        let mut c = a;
        c += b;
        c -= a;
        c *= 2.0;
        assert_eq!(c, b * 2.0);
        assert_eq!((a[0], a[1], a[2]), (1.0, 2.0, 3.0));
    }

    #[test]
    fn dot_and_cross() {
        let x = Vec3::new(1.0, 0.0, 0.0);
        let y = Vec3::new(0.0, 1.0, 0.0);
        let z = Vec3::new(0.0, 0.0, 1.0);
        assert_eq!(x.dot(y), 0.0);
        assert_eq!(Vec3::new(1.0, 2.0, 3.0).dot(Vec3::new(4.0, 5.0, 6.0)), 32.0);
        assert_eq!(x.cross(y), z);
        assert_eq!(y.cross(z), x);
        assert_eq!(z.cross(x), y);
        assert_eq!(y.cross(x), -z);
    }

    #[test]
    fn length_and_normalize() {
        let v = Vec3::new(3.0, 4.0, 0.0);
        assert!(close(v.length(), 5.0));
        assert!(close(v.length_squared(), 25.0));
        let n = v.normalize();
        assert!(close(n.length(), 1.0));
        assert!(close(n.x, 0.6) && close(n.y, 0.8));
        assert_eq!(Vec3::ZERO.normalize(), Vec3::ZERO);
    }

    #[test]
    fn min_max_lerp() {
        let a = Vec3::new(1.0, 5.0, -2.0);
        let b = Vec3::new(3.0, 2.0, -4.0);
        assert_eq!(a.min(b), Vec3::new(1.0, 2.0, -4.0));
        assert_eq!(a.max(b), Vec3::new(3.0, 5.0, -2.0));
        assert_eq!(a.min_component(), -2.0);
        assert_eq!(a.max_component(), 5.0);
        assert_eq!(a.abs(), Vec3::new(1.0, 5.0, 2.0));
        assert_eq!(a.lerp(b, 0.0), a);
        assert_eq!(a.lerp(b, 1.0), b);
        assert_eq!(a.lerp(b, 0.5), Vec3::new(2.0, 3.5, -3.0));
        assert!(a.is_finite());
        assert!(!Vec3::new(f32::NAN, 0.0, 0.0).is_finite());
    }

    #[test]
    fn ray_at() {
        let r = Ray::new(Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 2.0, 0.0));
        assert_eq!(r.at(0.0), r.origin);
        assert_eq!(r.at(1.5), Vec3::new(1.0, 3.0, 0.0));
        assert_eq!(r.t_min, Ray::EPSILON);
        assert!(r.t_max.is_infinite());
    }

    #[test]
    fn aabb_union_extend_centroid_area() {
        let a = Aabb::new(Vec3::ZERO, Vec3::ONE);
        let b = Aabb::new(Vec3::new(2.0, -1.0, 0.5), Vec3::new(3.0, 0.0, 0.75));
        let u = a.union(b);
        assert_eq!(u.min, Vec3::new(0.0, -1.0, 0.0));
        assert_eq!(u.max, Vec3::new(3.0, 1.0, 1.0));
        assert_eq!(a.centroid(), Vec3::splat(0.5));
        assert!(close(a.surface_area(), 6.0));
        assert!(close(
            Aabb::new(Vec3::ZERO, Vec3::new(1.0, 2.0, 3.0)).surface_area(),
            22.0
        ));

        assert!(Aabb::EMPTY.is_empty());
        assert_eq!(Aabb::EMPTY.surface_area(), 0.0);
        assert_eq!(Aabb::EMPTY.union(a), a);
        let e = Aabb::EMPTY
            .extend(Vec3::new(1.0, 2.0, 3.0))
            .extend(Vec3::new(-1.0, 0.0, 5.0));
        assert_eq!(e.min, Vec3::new(-1.0, 0.0, 3.0));
        assert_eq!(e.max, Vec3::new(1.0, 2.0, 5.0));
    }

    #[test]
    fn aabb_slab_hit_and_miss() {
        let b = Aabb::new(Vec3::new(-1.0, -1.0, -1.0), Vec3::new(1.0, 1.0, 1.0));
        let hit = Ray::new(Vec3::new(0.0, 0.0, -5.0), Vec3::new(0.0, 0.0, 1.0));
        let (near, far) = b.intersect(&hit, hit.dir.recip()).expect("hit");
        assert!(close(near, 4.0) && close(far, 6.0));

        let miss = Ray::new(Vec3::new(3.0, 0.0, -5.0), Vec3::new(0.0, 0.0, 1.0));
        assert!(b.intersect(&miss, miss.dir.recip()).is_none());

        // Pointing away from the box.
        let away = Ray::new(Vec3::new(0.0, 0.0, -5.0), Vec3::new(0.0, 0.0, -1.0));
        assert!(b.intersect(&away, away.dir.recip()).is_none());

        // Origin inside the box: the interval starts at t_min.
        let inside = Ray::new(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0));
        let (near, far) = b.intersect(&inside, inside.dir.recip()).expect("inside");
        assert!(close(near, Ray::EPSILON) && close(far, 1.0));

        // Clipped by t_max before reaching the box.
        let mut short = hit;
        short.t_max = 3.0;
        assert!(b.intersect(&short, short.dir.recip()).is_none());
    }

    #[test]
    fn aabb_slab_handles_axis_parallel_boundaries() {
        let b = Aabb::new(Vec3::ZERO, Vec3::ONE);
        // Direction has zero x/y components, origin x is exactly on the min face: 0 * inf = NaN.
        let grazing = Ray::new(Vec3::new(0.0, 0.5, -2.0), Vec3::new(0.0, 0.0, 1.0));
        assert!(b.intersect(&grazing, grazing.dir.recip()).is_some());
        // Parallel and strictly outside.
        let outside = Ray::new(Vec3::new(-0.5, 0.5, -2.0), Vec3::new(0.0, 0.0, 1.0));
        assert!(b.intersect(&outside, outside.dir.recip()).is_none());
    }
}

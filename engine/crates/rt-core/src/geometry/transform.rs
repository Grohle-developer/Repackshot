//! Affine transforms as 3x4 matrices.

use crate::math::{Aabb, Ray, Vec3};

/// An affine transform `p' = M · [p, 1]`, stored as the three rows of a 3x4 matrix: the left
/// 3x3 block is the linear part, the last column the translation.
///
/// Only IEEE add and multiply are used, in a fixed order, so applying a transform gives the same
/// bits on every platform. There are deliberately no rotation-by-angle constructors: `sin` and
/// `cos` are not correctly rounded and differ between platforms; the host computes rotation
/// matrices and sends them as rows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transform {
    /// Rows of the matrix.
    pub rows: [[f32; 4]; 3],
}

impl Default for Transform {
    fn default() -> Transform {
        Transform::IDENTITY
    }
}

impl Transform {
    /// The identity.
    pub const IDENTITY: Transform = Transform {
        rows: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ],
    };

    /// A transform from its rows.
    pub const fn from_rows(rows: [[f32; 4]; 3]) -> Transform {
        Transform { rows }
    }

    /// A translation by `t`.
    pub const fn translation(t: Vec3) -> Transform {
        Transform {
            rows: [
                [1.0, 0.0, 0.0, t.x],
                [0.0, 1.0, 0.0, t.y],
                [0.0, 0.0, 1.0, t.z],
            ],
        }
    }

    /// A scale by `s` along each axis, about the origin.
    pub const fn scale(s: Vec3) -> Transform {
        Transform {
            rows: [
                [s.x, 0.0, 0.0, 0.0],
                [0.0, s.y, 0.0, 0.0],
                [0.0, 0.0, s.z, 0.0],
            ],
        }
    }

    /// `self` followed by `next`: the transform that maps `p` to `next.point(self.point(p))`.
    pub fn then(&self, next: &Transform) -> Transform {
        let a = &next.rows;
        let b = &self.rows;
        let mut rows = [[0.0f32; 4]; 3];
        for (i, row) in rows.iter_mut().enumerate() {
            for (j, value) in row.iter_mut().enumerate() {
                *value = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
            }
            row[3] += a[i][3];
        }
        Transform { rows }
    }

    /// Applies the transform to a point.
    #[inline]
    pub fn point(&self, p: Vec3) -> Vec3 {
        let r = &self.rows;
        Vec3::new(
            r[0][0] * p.x + r[0][1] * p.y + r[0][2] * p.z + r[0][3],
            r[1][0] * p.x + r[1][1] * p.y + r[1][2] * p.z + r[1][3],
            r[2][0] * p.x + r[2][1] * p.y + r[2][2] * p.z + r[2][3],
        )
    }

    /// Applies the linear part to a direction (no translation).
    #[inline]
    pub fn vector(&self, v: Vec3) -> Vec3 {
        let r = &self.rows;
        Vec3::new(
            r[0][0] * v.x + r[0][1] * v.y + r[0][2] * v.z,
            r[1][0] * v.x + r[1][1] * v.y + r[1][2] * v.z,
            r[2][0] * v.x + r[2][1] * v.y + r[2][2] * v.z,
        )
    }

    /// Applies the *transpose* of the linear part. With the inverse transform this maps normals:
    /// `n_world = inverse.transpose_vector(n_object)`.
    #[inline]
    pub fn transpose_vector(&self, v: Vec3) -> Vec3 {
        let r = &self.rows;
        Vec3::new(
            r[0][0] * v.x + r[1][0] * v.y + r[2][0] * v.z,
            r[0][1] * v.x + r[1][1] * v.y + r[2][1] * v.z,
            r[0][2] * v.x + r[1][2] * v.y + r[2][2] * v.z,
        )
    }

    /// Applies the transform to a ray. The parameter `t` is preserved (the direction is not
    /// renormalised), so a hit at `t` in one space is at `t` in the other.
    #[inline]
    pub fn ray(&self, ray: &Ray) -> Ray {
        Ray {
            origin: self.point(ray.origin),
            dir: self.vector(ray.dir),
            t_min: ray.t_min,
            t_max: ray.t_max,
        }
    }

    /// Determinant of the linear part.
    pub fn determinant(&self) -> f32 {
        let r = &self.rows;
        r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1])
            - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
            + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0])
    }

    /// The inverse transform, or `None` when the matrix is singular or not finite.
    pub fn inverse(&self) -> Option<Transform> {
        if !self.is_finite() {
            return None;
        }
        let r = &self.rows;
        let det = self.determinant();
        if det == 0.0 || !det.is_finite() {
            return None;
        }
        let inv_det = 1.0 / det;
        // Adjugate (transposed cofactors) divided by the determinant.
        let c = [
            [
                r[1][1] * r[2][2] - r[1][2] * r[2][1],
                r[0][2] * r[2][1] - r[0][1] * r[2][2],
                r[0][1] * r[1][2] - r[0][2] * r[1][1],
            ],
            [
                r[1][2] * r[2][0] - r[1][0] * r[2][2],
                r[0][0] * r[2][2] - r[0][2] * r[2][0],
                r[0][2] * r[1][0] - r[0][0] * r[1][2],
            ],
            [
                r[1][0] * r[2][1] - r[1][1] * r[2][0],
                r[0][1] * r[2][0] - r[0][0] * r[2][1],
                r[0][0] * r[1][1] - r[0][1] * r[1][0],
            ],
        ];
        let mut rows = [[0.0f32; 4]; 3];
        for i in 0..3 {
            for j in 0..3 {
                rows[i][j] = c[i][j] * inv_det;
            }
        }
        let t = [r[0][3], r[1][3], r[2][3]];
        for row in &mut rows {
            row[3] = -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2]);
        }
        let inverse = Transform { rows };
        inverse.is_finite().then_some(inverse)
    }

    /// True when every entry is finite.
    pub fn is_finite(&self) -> bool {
        self.rows.iter().flatten().all(|v| v.is_finite())
    }

    /// True when the transform is exactly the identity.
    pub fn is_identity(&self) -> bool {
        *self == Transform::IDENTITY
    }

    /// Bounding box of the transformed corners of `b` ([`Aabb::EMPTY`] stays empty).
    pub fn aabb(&self, b: &Aabb) -> Aabb {
        if b.is_empty() {
            return Aabb::EMPTY;
        }
        let mut out = Aabb::EMPTY;
        for corner in 0..8 {
            let p = Vec3::new(
                if corner & 1 == 0 { b.min.x } else { b.max.x },
                if corner & 2 == 0 { b.min.y } else { b.max.y },
                if corner & 4 == 0 { b.min.z } else { b.max.z },
            );
            out = out.extend(self.point(p));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3) -> bool {
        (a - b).length() < 1.0e-4
    }

    fn sample() -> Transform {
        Transform::from_rows([
            [0.0, -2.0, 0.0, 10.0],
            [1.5, 0.0, 0.0, -3.0],
            [0.0, 0.5, 3.0, 7.0],
        ])
    }

    #[test]
    fn points_vectors_and_composition() {
        let t = Transform::translation(Vec3::new(1.0, 2.0, 3.0));
        let s = Transform::scale(Vec3::new(2.0, 3.0, 4.0));
        let p = Vec3::new(1.0, 1.0, 1.0);
        assert_eq!(t.point(p), Vec3::new(2.0, 3.0, 4.0));
        assert_eq!(t.vector(p), p);
        assert_eq!(s.point(p), Vec3::new(2.0, 3.0, 4.0));
        // Scale first, then translate.
        assert_eq!(s.then(&t).point(p), Vec3::new(3.0, 5.0, 7.0));
        assert_eq!(t.then(&s).point(p), Vec3::new(4.0, 9.0, 16.0));
        assert!(Transform::IDENTITY.is_identity());
        assert_eq!(Transform::default(), Transform::IDENTITY);
        assert!(!t.is_identity());
    }

    #[test]
    fn inverse_undoes_the_transform() {
        let m = sample();
        let inv = m.inverse().expect("invertible");
        let p = Vec3::new(0.3, -1.2, 4.5);
        assert!(close(inv.point(m.point(p)), p));
        assert!(close(m.point(inv.point(p)), p));
        assert!((m.determinant() * inv.determinant() - 1.0).abs() < 1.0e-5);
        assert_eq!(Transform::IDENTITY.inverse(), Some(Transform::IDENTITY));
        assert_eq!(Transform::scale(Vec3::new(1.0, 0.0, 1.0)).inverse(), None);
        let mut nan = m;
        nan.rows[1][2] = f32::NAN;
        assert_eq!(nan.inverse(), None);
    }

    #[test]
    fn normals_stay_perpendicular_under_the_inverse_transpose() {
        let m = sample();
        let inv = m.inverse().expect("invertible");
        let (a, b) = (Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0));
        let n = a.cross(b);
        let n_world = inv.transpose_vector(n);
        assert!(n_world.dot(m.vector(a)).abs() < 1.0e-5);
        assert!(n_world.dot(m.vector(b)).abs() < 1.0e-5);
    }

    #[test]
    fn rays_keep_their_parameter() {
        let m = sample();
        let ray = Ray::new(Vec3::new(1.0, 2.0, 3.0), Vec3::new(0.5, -0.25, 1.0));
        let moved = m.ray(&ray);
        assert!(close(moved.at(2.5), m.point(ray.at(2.5))));
        assert_eq!((moved.t_min, moved.t_max), (ray.t_min, ray.t_max));
    }

    #[test]
    fn boxes_contain_the_transformed_corners() {
        let m = sample();
        let b = Aabb::new(Vec3::new(-1.0, -2.0, -3.0), Vec3::new(1.0, 2.0, 3.0));
        let out = m.aabb(&b);
        for corner in [b.min, b.max, Vec3::new(b.min.x, b.max.y, b.min.z)] {
            let p = m.point(corner);
            assert!(p.x >= out.min.x && p.x <= out.max.x);
            assert!(p.y >= out.min.y && p.y <= out.max.y);
            assert!(p.z >= out.min.z && p.z <= out.max.z);
        }
        assert!(m.aabb(&Aabb::EMPTY).is_empty());
    }
}

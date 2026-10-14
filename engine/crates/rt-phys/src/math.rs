//! Quaternions and 3 x 3 matrices for the simulator, over the engine's [`Vec3`]. Only IEEE `+ - * /`
//! and `sqrt` (and `fmath` where an angle is turned into a rotation), so every result is the same
//! bits on every platform.

use rt_core::fmath;
use rt_core::math::Vec3;

/// `x > t`, false when either is NaN (where a negated comparison would be true).
#[inline]
pub fn above(x: f32, t: f32) -> bool {
    x > t
}

/// A rotation as a unit quaternion `w + xi + yj + zk`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    /// Vector part, x.
    pub x: f32,
    /// Vector part, y.
    pub y: f32,
    /// Vector part, z.
    pub z: f32,
    /// Scalar part.
    pub w: f32,
}

impl Quat {
    /// No rotation.
    pub const IDENTITY: Quat = Quat {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    };

    /// A quaternion from its four components.
    pub const fn new(x: f32, y: f32, z: f32, w: f32) -> Quat {
        Quat { x, y, z, w }
    }

    /// The rotation of `angle` radians about the unit vector `axis` (right hand).
    pub fn from_axis_angle(axis: Vec3, angle: f32) -> Quat {
        let (s, c) = fmath::sin_cos(0.5 * angle);
        let a = axis.normalize();
        Quat::new(a.x * s, a.y * s, a.z * s, c)
    }

    /// The conjugate: the inverse rotation of a unit quaternion.
    #[inline]
    pub fn conj(self) -> Quat {
        Quat::new(-self.x, -self.y, -self.z, self.w)
    }

    /// The vector part.
    #[inline]
    pub fn vector(self) -> Vec3 {
        Vec3::new(self.x, self.y, self.z)
    }

    /// `v` rotated by this unit quaternion (`q v q*`, in the two-cross-product form).
    #[inline]
    pub fn rotate(self, v: Vec3) -> Vec3 {
        let u = self.vector();
        let t = u.cross(v) * 2.0;
        v + t * self.w + u.cross(t)
    }

    /// `v` rotated by the inverse rotation.
    #[inline]
    pub fn unrotate(self, v: Vec3) -> Vec3 {
        self.conj().rotate(v)
    }

    /// The same rotation with unit length (the identity for a zero quaternion).
    #[inline]
    pub fn normalize(self) -> Quat {
        let n = (self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w).sqrt();
        if n > 0.0 && n.is_finite() {
            let k = 1.0 / n;
            Quat::new(self.x * k, self.y * k, self.z * k, self.w * k)
        } else {
            Quat::IDENTITY
        }
    }

    /// Adds the change of orientation of an angular displacement `dw` (world space, radians):
    /// `q + 0.5 [dw, 0] q`, renormalised (the first-order update of the XPBD paper).
    #[inline]
    pub fn add_rotation(self, dw: Vec3) -> Quat {
        let d = Quat::new(dw.x, dw.y, dw.z, 0.0) * self;
        Quat::new(
            self.x + 0.5 * d.x,
            self.y + 0.5 * d.y,
            self.z + 0.5 * d.z,
            self.w + 0.5 * d.w,
        )
        .normalize()
    }

    /// The rotation matrix.
    pub fn to_mat3(self) -> Mat3 {
        let (x, y, z, w) = (self.x, self.y, self.z, self.w);
        Mat3::from_rows([
            [
                1.0 - 2.0 * (y * y + z * z),
                2.0 * (x * y - z * w),
                2.0 * (x * z + y * w),
            ],
            [
                2.0 * (x * y + z * w),
                1.0 - 2.0 * (x * x + z * z),
                2.0 * (y * z - x * w),
            ],
            [
                2.0 * (x * z - y * w),
                2.0 * (y * z + x * w),
                1.0 - 2.0 * (x * x + y * y),
            ],
        ])
    }

    /// The unit quaternion of a rotation matrix (Shepperd's choice of the largest diagonal term).
    pub fn from_mat3(m: &Mat3) -> Quat {
        let r = &m.m;
        let trace = r[0][0] + r[1][1] + r[2][2];
        let q = if trace > 0.0 {
            let s = (trace + 1.0).sqrt() * 2.0;
            Quat::new(
                (r[2][1] - r[1][2]) / s,
                (r[0][2] - r[2][0]) / s,
                (r[1][0] - r[0][1]) / s,
                0.25 * s,
            )
        } else if r[0][0] > r[1][1] && r[0][0] > r[2][2] {
            let s = (1.0 + r[0][0] - r[1][1] - r[2][2]).sqrt() * 2.0;
            Quat::new(
                0.25 * s,
                (r[0][1] + r[1][0]) / s,
                (r[0][2] + r[2][0]) / s,
                (r[2][1] - r[1][2]) / s,
            )
        } else if r[1][1] > r[2][2] {
            let s = (1.0 + r[1][1] - r[0][0] - r[2][2]).sqrt() * 2.0;
            Quat::new(
                (r[0][1] + r[1][0]) / s,
                0.25 * s,
                (r[1][2] + r[2][1]) / s,
                (r[0][2] - r[2][0]) / s,
            )
        } else {
            let s = (1.0 + r[2][2] - r[0][0] - r[1][1]).sqrt() * 2.0;
            Quat::new(
                (r[0][2] + r[2][0]) / s,
                (r[1][2] + r[2][1]) / s,
                0.25 * s,
                (r[1][0] - r[0][1]) / s,
            )
        };
        q.normalize()
    }
}

impl std::ops::Mul for Quat {
    type Output = Quat;

    /// The Hamilton product `self * o` (apply `o` first, then `self`).
    #[inline]
    fn mul(self, o: Quat) -> Quat {
        Quat {
            w: self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
            x: self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            y: self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            z: self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
        }
    }
}

/// A 3 x 3 matrix, by rows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat3 {
    /// `m[row][column]`.
    pub m: [[f32; 3]; 3],
}

impl Mat3 {
    /// All zeros.
    pub const ZERO: Mat3 = Mat3 { m: [[0.0; 3]; 3] };
    /// The identity.
    pub const IDENTITY: Mat3 = Mat3 {
        m: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    };

    /// A matrix from its rows.
    pub const fn from_rows(m: [[f32; 3]; 3]) -> Mat3 {
        Mat3 { m }
    }

    /// The diagonal matrix of `d`.
    pub fn diagonal(d: Vec3) -> Mat3 {
        Mat3::from_rows([[d.x, 0.0, 0.0], [0.0, d.y, 0.0], [0.0, 0.0, d.z]])
    }

    /// The matrix whose columns are `a`, `b`, `c`.
    pub fn from_columns(a: Vec3, b: Vec3, c: Vec3) -> Mat3 {
        Mat3::from_rows([[a.x, b.x, c.x], [a.y, b.y, c.y], [a.z, b.z, c.z]])
    }

    /// Column `i`.
    pub fn column(&self, i: usize) -> Vec3 {
        Vec3::new(self.m[0][i], self.m[1][i], self.m[2][i])
    }

    /// `self * v`.
    #[inline]
    pub fn mul_vec(&self, v: Vec3) -> Vec3 {
        let r = &self.m;
        Vec3::new(
            r[0][0] * v.x + r[0][1] * v.y + r[0][2] * v.z,
            r[1][0] * v.x + r[1][1] * v.y + r[1][2] * v.z,
            r[2][0] * v.x + r[2][1] * v.y + r[2][2] * v.z,
        )
    }

    /// `self * o`.
    pub fn mul(&self, o: &Mat3) -> Mat3 {
        let mut out = Mat3::ZERO;
        for i in 0..3 {
            for j in 0..3 {
                out.m[i][j] =
                    self.m[i][0] * o.m[0][j] + self.m[i][1] * o.m[1][j] + self.m[i][2] * o.m[2][j];
            }
        }
        out
    }

    /// The transpose.
    pub fn transpose(&self) -> Mat3 {
        let r = &self.m;
        Mat3::from_rows([
            [r[0][0], r[1][0], r[2][0]],
            [r[0][1], r[1][1], r[2][1]],
            [r[0][2], r[1][2], r[2][2]],
        ])
    }

    /// `self + o`.
    pub fn add(&self, o: &Mat3) -> Mat3 {
        let mut out = *self;
        for i in 0..3 {
            for j in 0..3 {
                out.m[i][j] += o.m[i][j];
            }
        }
        out
    }

    /// `self * k`.
    pub fn scale(&self, k: f32) -> Mat3 {
        let mut out = *self;
        for row in out.m.iter_mut() {
            for v in row.iter_mut() {
                *v *= k;
            }
        }
        out
    }

    /// The outer product `a bᵀ`.
    pub fn outer(a: Vec3, b: Vec3) -> Mat3 {
        Mat3::from_rows([
            [a.x * b.x, a.x * b.y, a.x * b.z],
            [a.y * b.x, a.y * b.y, a.y * b.z],
            [a.z * b.x, a.z * b.y, a.z * b.z],
        ])
    }

    /// The trace.
    pub fn trace(&self) -> f32 {
        self.m[0][0] + self.m[1][1] + self.m[2][2]
    }

    /// The determinant.
    pub fn determinant(&self) -> f32 {
        let r = &self.m;
        r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1])
            - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
            + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0])
    }

    /// The inverse by cofactors, or `None` for a (numerically) singular matrix.
    pub fn inverse(&self) -> Option<Mat3> {
        let r = &self.m;
        let det = self.determinant();
        let scale = self.m.iter().flatten().fold(0.0f32, |a, v| a.max(v.abs()));
        if !above(det.abs(), 1e-12 * scale * scale * scale) || !det.is_finite() {
            return None;
        }
        let k = 1.0 / det;
        Some(Mat3::from_rows([
            [
                (r[1][1] * r[2][2] - r[1][2] * r[2][1]) * k,
                (r[0][2] * r[2][1] - r[0][1] * r[2][2]) * k,
                (r[0][1] * r[1][2] - r[0][2] * r[1][1]) * k,
            ],
            [
                (r[1][2] * r[2][0] - r[1][0] * r[2][2]) * k,
                (r[0][0] * r[2][2] - r[0][2] * r[2][0]) * k,
                (r[0][2] * r[1][0] - r[0][0] * r[1][2]) * k,
            ],
            [
                (r[1][0] * r[2][1] - r[1][1] * r[2][0]) * k,
                (r[0][1] * r[2][0] - r[0][0] * r[2][1]) * k,
                (r[0][0] * r[1][1] - r[0][1] * r[1][0]) * k,
            ],
        ]))
    }

    /// Eigenvectors (the columns of the returned rotation) and eigenvalues of a symmetric matrix,
    /// by cyclic Jacobi rotations: a fixed number of sweeps in a fixed order, so the result is the
    /// same bits everywhere. The columns form a right-handed frame.
    pub fn symmetric_eigen(&self) -> (Mat3, Vec3) {
        let mut a = self.m;
        let mut v = Mat3::IDENTITY.m;
        for _ in 0..16 {
            let off = a[0][1].abs() + a[0][2].abs() + a[1][2].abs();
            let diag = a[0][0].abs() + a[1][1].abs() + a[2][2].abs();
            if !above(off, 1e-9 * diag) {
                break;
            }
            for (p, q) in [(0usize, 1usize), (0, 2), (1, 2)] {
                if a[p][q] == 0.0 {
                    continue;
                }
                // The rotation that zeroes a[p][q]: tan(2θ) = 2 a_pq / (a_qq - a_pp).
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for row in a.iter_mut() {
                    let akp = row[p];
                    let akq = row[q];
                    row[p] = c * akp - s * akq;
                    row[q] = s * akp + c * akq;
                }
                let (rp, rq) = (a[p], a[q]);
                for k in 0..3 {
                    a[p][k] = c * rp[k] - s * rq[k];
                    a[q][k] = s * rp[k] + c * rq[k];
                }
                for row in v.iter_mut() {
                    let vkp = row[p];
                    let vkq = row[q];
                    row[p] = c * vkp - s * vkq;
                    row[q] = s * vkp + c * vkq;
                }
            }
        }
        let mut frame = Mat3::from_rows(v);
        // Right-handed: the third axis is the cross product of the first two.
        let c2 = frame.column(0).cross(frame.column(1));
        frame.m[0][2] = c2.x;
        frame.m[1][2] = c2.y;
        frame.m[2][2] = c2.z;
        (frame, Vec3::new(a[0][0], a[1][1], a[2][2]))
    }
}

/// `a` with the component along the unit vector `n` removed.
#[inline]
pub fn tangential(a: Vec3, n: Vec3) -> Vec3 {
    a - n * a.dot(n)
}

/// A unit vector perpendicular to the unit vector `n`.
pub fn any_perpendicular(n: Vec3) -> Vec3 {
    let a = if n.x.abs() < 0.57 {
        Vec3::new(1.0, 0.0, 0.0)
    } else {
        Vec3::new(0.0, 1.0, 0.0)
    };
    n.cross(a).normalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3, tol: f32) -> bool {
        (a - b).length() <= tol
    }

    #[test]
    fn rotation_and_matrix_agree() {
        let q = Quat::from_axis_angle(Vec3::new(1.0, 2.0, 3.0), 0.7);
        let m = q.to_mat3();
        for v in [Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.3, -2.0, 5.0)] {
            assert!(close(q.rotate(v), m.mul_vec(v), 1e-5));
            assert!(close(q.unrotate(q.rotate(v)), v, 1e-5));
        }
        let back = Quat::from_mat3(&m);
        // q and -q are the same rotation.
        let same = (back.x - q.x).abs() + (back.w - q.w).abs() < 1e-5
            || (back.x + q.x).abs() + (back.w + q.w).abs() < 1e-5;
        assert!(same, "{q:?} {back:?}");
    }

    #[test]
    fn a_quarter_turn_about_z() {
        let q = Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), std::f32::consts::FRAC_PI_2);
        assert!(close(
            q.rotate(Vec3::new(1.0, 0.0, 0.0)),
            Vec3::new(0.0, 1.0, 0.0),
            1e-6
        ));
        // Composition: two quarter turns are a half turn.
        assert!(close(
            (q * q).rotate(Vec3::new(1.0, 0.0, 0.0)),
            Vec3::new(-1.0, 0.0, 0.0),
            1e-6
        ));
    }

    #[test]
    fn inverse_and_eigen() {
        let a = Mat3::from_rows([[4.0, 1.0, 0.5], [1.0, 3.0, 0.2], [0.5, 0.2, 2.0]]);
        let inv = a.inverse().unwrap();
        let id = a.mul(&inv);
        for i in 0..3 {
            for j in 0..3 {
                let want = if i == j { 1.0 } else { 0.0 };
                assert!((id.m[i][j] - want).abs() < 1e-5);
            }
        }
        let (v, d) = a.symmetric_eigen();
        // A v_i = d_i v_i, and the frame is a right-handed rotation.
        for (i, di) in [d.x, d.y, d.z].into_iter().enumerate() {
            let vi = v.column(i);
            assert!(close(a.mul_vec(vi), vi * di, 1e-4), "{i}");
        }
        assert!((v.determinant() - 1.0).abs() < 1e-5);
        assert!(Mat3::ZERO.inverse().is_none());
    }
}

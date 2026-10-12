//! Watertight ray/triangle intersection.
//!
//! The algorithm is the one of S. Woop, C. Benthin and I. Wald, *"Watertight Ray/Triangle
//! Intersection"*, Journal of Computer Graphics Techniques 2(1), 2013. The ray is turned into the
//! +Z axis of a sheared space (the axis of its largest direction component becomes `kz`, the
//! other two are sheared by `-d[kx]/d[kz]`, `-d[ky]/d[kz]`), the vertices are moved into that
//! space relative to the ray origin, and the three 2D edge functions `U`, `V`, `W` decide the
//! hit. Because every edge is evaluated from the same transformed vertices, an edge shared by two
//! triangles gives exactly opposite values to both, so a ray can never slip between them.
//!
//! Differences from the paper, all deliberate:
//!
//! * Everything is `f32`. The paper re-evaluates an edge function in double precision when it is
//!   exactly zero; we accept zero as "on the edge" on both sides instead, which keeps the test
//!   watertight (a ray through a shared edge hits at least one triangle) at the price of rare
//!   double hits, which the nearest-hit tie-break resolves deterministically.
//! * `t` is `T / det` with a real division (not a reciprocal multiply), and both bounds of
//!   `[t_min, t_max]` are inclusive. Hits at infinity are rejected (`t_max` is clamped to
//!   `f32::MAX`).
//! * Degenerate triangles (zero area, repeated vertices) give `det == 0` and are never hit.
//!
//! The scalar [`watertight`] function is the reference; the 4-lane [`packet_hits`] used by the
//! BVH evaluates **the same operations in the same order**, so both return identical bits, which
//! the BVH-versus-brute-force tests rely on.

use crate::math::{Ray, Vec3};
use crate::simd::{Mask, Vector};

/// Front faces are those whose corners `v0, v1, v2` turn counter-clockwise when seen from the
/// ray origin, i.e. `dot((v1 - v0) x (v2 - v0), dir) < 0`. This flag rejects the other side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cull {
    /// Two sided: both faces are hit.
    None,
    /// One sided: back faces are not hit.
    Back,
}

/// A ray prepared for the slab test and the watertight test in one coordinate space.
#[derive(Clone, Copy, Debug)]
pub(crate) struct PreparedRay {
    /// Origin.
    pub org: [f32; 3],
    /// `1 / dir` per axis (may be infinite).
    pub inv: [f32; 3],
    /// Index into a node's bounds of the plane the ray meets first on each axis.
    pub near: [usize; 3],
    /// Index into a node's bounds of the plane the ray meets last on each axis.
    pub far: [usize; 3],
    /// Axis permutation of the sheared space.
    pub k: [usize; 3],
    /// Shear constants `d[kx]/d[kz]`, `d[ky]/d[kz]`, `1/d[kz]`.
    pub shear: [f32; 3],
    /// Start of the parameter interval.
    pub t_min: f32,
    /// End of the parameter interval, clamped to `f32::MAX`.
    pub t_max: f32,
}

impl PreparedRay {
    /// Precomputes everything the kernels need from `ray`.
    #[inline(always)]
    pub fn new(ray: &Ray) -> PreparedRay {
        let d = [ray.dir.x, ray.dir.y, ray.dir.z];
        let inv = [1.0 / d[0], 1.0 / d[1], 1.0 / d[2]];
        let a = [d[0].abs(), d[1].abs(), d[2].abs()];
        let kz = if a[0] >= a[1] && a[0] >= a[2] {
            0
        } else if a[1] >= a[2] {
            1
        } else {
            2
        };
        let (mut kx, mut ky) = ((kz + 1) % 3, (kz + 2) % 3);
        if d[kz] < 0.0 {
            // Keeps the winding (and so the sign of `det`) independent of the ray direction.
            std::mem::swap(&mut kx, &mut ky);
        }
        let mut near = [0; 3];
        let mut far = [0; 3];
        for axis in 0..3 {
            // Bounds are stored [min_x, max_x, min_y, max_y, min_z, max_z]. A negative
            // direction (including -0, whose reciprocal is -inf) meets the max plane first.
            let negative = usize::from(inv[axis].is_sign_negative());
            near[axis] = axis * 2 + negative;
            far[axis] = axis * 2 + 1 - negative;
        }
        PreparedRay {
            org: [ray.origin.x, ray.origin.y, ray.origin.z],
            inv,
            near,
            far,
            k: [kx, ky, kz],
            shear: [d[kx] / d[kz], d[ky] / d[kz], 1.0 / d[kz]],
            t_min: ray.t_min,
            t_max: ray.t_max.min(f32::MAX),
        }
    }
}

/// The raw result of the watertight test: `t` and the unnormalised barycentric weights.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct EdgeHit {
    /// Ray parameter.
    pub t: f32,
    /// Edge functions: the weights of `v0`, `v1`, `v2`, each to be divided by `det`.
    pub uvw: [f32; 3],
    /// `U + V + W`, never zero for a hit.
    pub det: f32,
}

/// The scalar watertight test against `[r.t_min, t_max]`. See the module documentation.
#[inline(always)]
pub(crate) fn watertight(
    r: &PreparedRay,
    v0: Vec3,
    v1: Vec3,
    v2: Vec3,
    t_max: f32,
    cull: Cull,
) -> Option<EdgeHit> {
    let [kx, ky, kz] = r.k;
    let [sx, sy, sz] = r.shear;
    let (ox, oy, oz) = (r.org[kx], r.org[ky], r.org[kz]);
    let (a_x, a_y, a_z) = (v0[kx] - ox, v0[ky] - oy, v0[kz] - oz);
    let (b_x, b_y, b_z) = (v1[kx] - ox, v1[ky] - oy, v1[kz] - oz);
    let (c_x, c_y, c_z) = (v2[kx] - ox, v2[ky] - oy, v2[kz] - oz);
    let (ax, ay) = (a_x - sx * a_z, a_y - sy * a_z);
    let (bx, by) = (b_x - sx * b_z, b_y - sy * b_z);
    let (cx, cy) = (c_x - sx * c_z, c_y - sy * c_z);
    let u = cx * by - cy * bx;
    let v = ax * cy - ay * cx;
    let w = bx * ay - by * ax;
    let negative = u < 0.0 || v < 0.0 || w < 0.0;
    let positive = u > 0.0 || v > 0.0 || w > 0.0;
    let rejected = match cull {
        Cull::None => negative && positive,
        Cull::Back => negative,
    };
    let det = u + v + w;
    if rejected || det == 0.0 {
        return None;
    }
    let (az, bz, cz) = (sz * a_z, sz * b_z, sz * c_z);
    let t = (u * az + v * bz + w * cz) / det;
    if t >= r.t_min && t <= t_max {
        Some(EdgeHit {
            t,
            uvw: [u, v, w],
            det,
        })
    } else {
        None
    }
}

/// Four triangles in structure-of-arrays form, the unit of work of the BVH leaves.
///
/// `v[corner][axis][lane]`. Unused lanes repeat the last real triangle of the packet (same id),
/// which can only produce a duplicate of a hit the packet already reports.
#[derive(Clone, Debug, PartialEq)]
#[repr(C, align(16))]
pub(crate) struct TriPacket {
    /// Corner coordinates.
    pub v: [[[f32; 4]; 3]; 3],
    /// Triangle index in the mesh of each lane.
    pub id: [u32; 4],
}

/// The ray of a [`PreparedRay`] splatted across four lanes for [`packet_hits`].
#[derive(Clone, Copy, Debug)]
pub(crate) struct RayLanes<V> {
    k: [usize; 3],
    org: [V; 3],
    shear: [V; 3],
    t_min: V,
}

impl<V: Vector<Array = [f32; 4]>> RayLanes<V> {
    /// Splats the ray.
    #[inline(always)]
    pub fn new(r: &PreparedRay) -> Self {
        let [kx, ky, kz] = r.k;
        RayLanes {
            k: r.k,
            org: [V::splat(r.org[kx]), V::splat(r.org[ky]), V::splat(r.org[kz])],
            shear: [
                V::splat(r.shear[0]),
                V::splat(r.shear[1]),
                V::splat(r.shear[2]),
            ],
            t_min: V::splat(r.t_min),
        }
    }
}

/// The watertight test on the four lanes of `p`: a bit mask of the lanes hit within
/// `[t_min, t_max]` and their `t`. Same operations, same order as [`watertight`].
#[inline(always)]
pub(crate) fn packet_hits<V: Vector<Array = [f32; 4]>>(
    r: &RayLanes<V>,
    p: &TriPacket,
    t_max: f32,
    cull: Cull,
) -> (u32, [f32; 4]) {
    let [kx, ky, kz] = r.k;
    let [ox, oy, oz] = r.org;
    let [sx, sy, sz] = r.shear;
    let corner = |c: &[[f32; 4]; 3]| {
        (
            V::load(&c[kx]) - ox,
            V::load(&c[ky]) - oy,
            V::load(&c[kz]) - oz,
        )
    };
    let (a_x, a_y, a_z) = corner(&p.v[0]);
    let (b_x, b_y, b_z) = corner(&p.v[1]);
    let (c_x, c_y, c_z) = corner(&p.v[2]);
    let (ax, ay) = (a_x - sx * a_z, a_y - sy * a_z);
    let (bx, by) = (b_x - sx * b_z, b_y - sy * b_z);
    let (cx, cy) = (c_x - sx * c_z, c_y - sy * c_z);
    let u = cx * by - cy * bx;
    let v = ax * cy - ay * cx;
    let w = bx * ay - by * ax;
    let zero = V::splat(0.0);
    let negative = u.lt(zero) | v.lt(zero) | w.lt(zero);
    let rejected = match cull {
        Cull::None => negative & (u.gt(zero) | v.gt(zero) | w.gt(zero)),
        Cull::Back => negative,
    };
    let det = u + v + w;
    let (az, bz, cz) = (sz * a_z, sz * b_z, sz * c_z);
    let t = (u * az + v * bz + w * cz) / det;
    let inside = t.ge(r.t_min) & t.le(V::splat(t_max));
    let valid = inside.and_not(rejected | det.eq(zero));
    (valid.bitmask(), t.to_array())
}

/// Result of [`intersect_triangle`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TriangleHit {
    /// Ray parameter of the hit.
    pub t: f32,
    /// Barycentric weight of the second vertex.
    pub u: f32,
    /// Barycentric weight of the third vertex. The first vertex has weight `1 - u - v`.
    pub v: f32,
}

/// Two-sided watertight ray/triangle intersection. Only hits with `t` inside
/// `[ray.t_min, ray.t_max]` count.
pub fn intersect_triangle(ray: &Ray, p0: Vec3, p1: Vec3, p2: Vec3) -> Option<TriangleHit> {
    let r = PreparedRay::new(ray);
    watertight(&r, p0, p1, p2, r.t_max, Cull::None).map(|h| TriangleHit {
        t: h.t,
        u: h.uvw[1] / h.det,
        v: h.uvw[2] / h.det,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;
    use crate::simd::{scalar, Backend, Isa, Kernel};

    #[test]
    fn hits_misses_and_respects_the_interval() {
        let (a, b, c) = (
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        );
        let down = Ray::new(Vec3::new(0.25, 0.25, 2.0), Vec3::new(0.0, 0.0, -1.0));
        let hit = intersect_triangle(&down, a, b, c).expect("hit");
        assert!((hit.t - 2.0).abs() < 1.0e-6);
        assert!((hit.u - 0.25).abs() < 1.0e-6 && (hit.v - 0.25).abs() < 1.0e-6);
        // Two sided: the same triangle seen from below.
        let up = Ray::new(Vec3::new(0.25, 0.25, -2.0), Vec3::new(0.0, 0.0, 1.0));
        assert!(intersect_triangle(&up, a, b, c).is_some());
        // Outside of the triangle, parallel, and out of the interval.
        let outside = Ray::new(Vec3::new(0.9, 0.9, 2.0), Vec3::new(0.0, 0.0, -1.0));
        assert!(intersect_triangle(&outside, a, b, c).is_none());
        let parallel = Ray::new(Vec3::new(0.25, 0.25, 2.0), Vec3::new(1.0, 0.0, 0.0));
        assert!(intersect_triangle(&parallel, a, b, c).is_none());
        let mut short = down;
        short.t_max = 1.0;
        assert!(intersect_triangle(&short, a, b, c).is_none());
        let mut behind = down;
        behind.t_min = 3.0;
        assert!(intersect_triangle(&behind, a, b, c).is_none());
        // Both bounds are inclusive.
        let mut exact = down;
        exact.t_max = 2.0;
        assert!(intersect_triangle(&exact, a, b, c).is_some());
        // Degenerate triangles.
        assert!(intersect_triangle(&down, a, a, a).is_none());
        assert!(intersect_triangle(&down, a, b, b * 2.0).is_none());
    }

    #[test]
    fn front_faces_are_counter_clockwise_and_back_faces_can_be_culled() {
        let (a, b, c) = (
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        );
        // The winding normal is +Z: a ray going down sees the front face.
        for (origin, dir, front) in [
            (Vec3::new(0.2, 0.3, 5.0), Vec3::new(0.0, 0.0, -1.0), true),
            (Vec3::new(0.2, 0.3, -5.0), Vec3::new(0.0, 0.0, 1.0), false),
            (Vec3::new(0.2, 0.3, 5.0), Vec3::new(0.1, -0.2, -1.0), true),
            (Vec3::new(5.0, 0.3, 0.1), Vec3::new(-1.0, 0.0, -0.05), true),
            (Vec3::new(5.0, 0.3, -0.1), Vec3::new(-1.0, 0.0, 0.05), false),
        ] {
            let r = PreparedRay::new(&Ray::new(origin, dir));
            let two = watertight(&r, a, b, c, f32::MAX, Cull::None).expect("hit");
            assert_eq!(two.det > 0.0, front, "{origin:?} {dir:?}");
            assert_eq!(
                watertight(&r, a, b, c, f32::MAX, Cull::Back).is_some(),
                front
            );
        }
    }

    #[test]
    fn a_shared_edge_never_lets_a_ray_through() {
        // A quad split along its diagonal; rays aimed exactly at the diagonal must hit.
        let (p0, p1, p2, p3) = (
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(1.0, 1.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        );
        let mut rng = Pcg32::seeded(5, 5);
        for _ in 0..2000 {
            let s = rng.next_f32();
            let target = p0.lerp(p2, s);
            let origin = Vec3::new(
                rng.next_f32() * 4.0 - 2.0,
                rng.next_f32() * 4.0 - 2.0,
                1.0 + rng.next_f32() * 3.0,
            );
            let ray = Ray {
                origin,
                dir: target - origin,
                t_min: 0.0,
                t_max: f32::INFINITY,
            };
            let first = intersect_triangle(&ray, p0, p1, p2);
            let second = intersect_triangle(&ray, p0, p2, p3);
            assert!(
                first.is_some() || second.is_some(),
                "ray through {target:?} slipped through the diagonal"
            );
        }
    }

    /// Random packets and rays: the 4-lane test must agree with the scalar test bit for bit.
    struct PacketKernel<'a> {
        rays: &'a [PreparedRay],
        packets: &'a [TriPacket],
    }

    impl Kernel for PacketKernel<'_> {
        type Output = Vec<(u32, [u32; 4])>;
        fn run<B: Backend>(self) -> Self::Output {
            let mut out = Vec::new();
            for r in self.rays {
                let lanes = RayLanes::<B::V4>::new(r);
                for p in self.packets {
                    for cull in [Cull::None, Cull::Back] {
                        let (bits, t) = packet_hits(&lanes, p, r.t_max, cull);
                        out.push((bits, t.map(|v| if bits == 0 { 0 } else { v.to_bits() })));
                    }
                }
            }
            out
        }
    }

    #[test]
    fn packets_match_the_scalar_test_on_every_path() {
        let mut rng = Pcg32::seeded(9, 1);
        let mut coord = |rng: &mut Pcg32| (rng.next_f32() - 0.5) * 4.0;
        let mut packets = Vec::new();
        for _ in 0..64 {
            let mut p = TriPacket {
                v: [[[0.0; 4]; 3]; 3],
                id: [0, 1, 2, 3],
            };
            for corner in 0..3 {
                for axis in 0..3 {
                    for lane in 0..4 {
                        p.v[corner][axis][lane] = coord(&mut rng);
                    }
                }
            }
            // Some degenerate lanes: a repeated corner.
            p.v[2][0][3] = p.v[0][0][3];
            p.v[2][1][3] = p.v[0][1][3];
            p.v[2][2][3] = p.v[0][2][3];
            packets.push(p);
        }
        let rays: Vec<PreparedRay> = (0..256)
            .map(|_| {
                let origin = Vec3::new(coord(&mut rng), coord(&mut rng), coord(&mut rng)) * 3.0;
                let dir = Vec3::new(coord(&mut rng), coord(&mut rng), coord(&mut rng));
                PreparedRay::new(&Ray::new(origin, dir))
            })
            .collect();

        // The scalar watertight function, lane by lane, is the reference.
        let mut reference = Vec::new();
        for r in &rays {
            for p in &packets {
                for cull in [Cull::None, Cull::Back] {
                    let mut bits = 0;
                    let mut t = [0u32; 4];
                    for lane in 0..4 {
                        let corner = |c: usize| {
                            Vec3::new(p.v[c][0][lane], p.v[c][1][lane], p.v[c][2][lane])
                        };
                        if let Some(h) =
                            watertight(r, corner(0), corner(1), corner(2), r.t_max, cull)
                        {
                            bits |= 1 << lane;
                            t[lane] = h.t.to_bits();
                        }
                    }
                    reference.push((bits, t));
                }
            }
        }
        // Lanes that miss carry an unspecified t: compare t only for hit lanes.
        let normalise = |v: Vec<(u32, [u32; 4])>| -> Vec<(u32, [u32; 4])> {
            v.into_iter()
                .map(|(bits, t)| {
                    let mut t = t;
                    for (lane, value) in t.iter_mut().enumerate() {
                        if bits & (1 << lane) == 0 {
                            *value = 0;
                        }
                    }
                    (bits, t)
                })
                .collect()
        };
        let reference = normalise(reference);
        assert!(reference.iter().any(|(bits, _)| *bits != 0));
        for isa in Isa::available() {
            let got = normalise(isa.dispatch(PacketKernel {
                rays: &rays,
                packets: &packets,
            }));
            assert_eq!(got, reference, "{}", isa.name());
        }
        // The scalar vector type itself, outside any dispatch.
        let lanes = RayLanes::<scalar::F32x4>::new(&rays[0]);
        let _ = packet_hits(&lanes, &packets[0], f32::MAX, Cull::None);
    }
}

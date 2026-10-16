//! Where a point of a part reads a slot's image: the projections of `src/core/textures.ts`
//! (`projectPoint`, whose results at sample points the tests pin) in `f32`, with the surface
//! gradients of the coordinates they give (for the level of detail and the tangent frame of a
//! normal map), and the labels' planar projection (`labelCoords`).
//!
//! Coordinates before the turn, `(cu, cv)`, in the part's own space (mm), for a slot of size
//! `w = size_mm` and `h = size_mm / aspect` (the image's width over height):
//!
//! * **UV**: the mesh's coordinates of the set; no centring.
//! * **Planar**: looking along Z `(x, y)`, along Y `(x, z)`, along X `(y, z)`, over `(w, h)`.
//! * **Box**: for each axis, the image seen from outside the face that axis is square to, never
//!   mirrored: Z `(n.z ≥ 0 ? x : −x, y)`, Y `(n.y ≤ 0 ? x : −x, z)`, X `(n.x ≥ 0 ? y : −y, z)`,
//!   over `(w, h)`, weighted by `|n_i|⁴` normalised (all three always, as Fast blends them).
//! * **Cylindrical** about an axis with cross-section axes `(S, T)` (Z: x, y; X: y, z; Y: z, x):
//!   `cu = (atan2(T, S) + π/2) / 2π` brought to `−½ … ½` (0 at the front, −T), `cv = A / h`.
//! * **Spherical**: the same `cu`, `cv = asin(A / |p|) / π`.
//!
//! Then `uv = R(rotation)·(c ⊙ repeat) + offset`, plus ½ for every projection but UV. The
//! gradients are those of these formulas (exact; the turn's at its own point, so the seam of a
//! cylinder has none).

use super::{
    TextureSlot, AXIS_X, AXIS_Z, PROJECTION_BOX, PROJECTION_CYLINDRICAL, PROJECTION_PLANAR,
    PROJECTION_SPHERICAL, PROJECTION_UV,
};
use crate::fmath;
use crate::math::Vec3;

/// The unit vectors of the three axes.
const AXES: [Vec3; 3] = [
    Vec3::new(1.0, 0.0, 0.0),
    Vec3::new(0.0, 1.0, 0.0),
    Vec3::new(0.0, 0.0, 1.0),
];

/// Indices of the cross-section axes `S`, `T` and of the axis itself (`sectionAxes`).
#[inline]
fn section(axis: u32) -> (usize, usize, usize) {
    match axis {
        AXIS_X => (1, 2, 0),
        AXIS_Z => (0, 1, 2),
        _ => (2, 0, 1),
    }
}

/// The component `i` of `p`.
#[inline]
fn comp(p: Vec3, i: usize) -> f32 {
    match i {
        0 => p.x,
        1 => p.y,
        _ => p.z,
    }
}

/// One way a point reads an image: its coordinates, how much it counts, and the gradients of
/// `u` and `v` in the part's space (mm⁻¹).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Coord {
    /// The coordinates, before the wrap.
    pub u: f32,
    /// v up.
    pub v: f32,
    /// Its weight (1 but for the axes of a box projection).
    pub weight: f32,
    /// ∇u.
    pub du: Vec3,
    /// ∇v.
    pub dv: Vec3,
}

/// The coordinates of a point: one, or three for a box projection (the axes in order X, Y, Z;
/// those that do not count have weight 0).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Projected {
    /// The coordinates; the first `count` are used.
    pub coords: [Coord; 3],
    /// 1, or 3.
    pub count: usize,
}

impl Projected {
    /// The coordinates that are used.
    pub fn used(&self) -> &[Coord] {
        &self.coords[..self.count]
    }
}

/// What the mesh gives the UV projection at a point: the coordinates of each set and their
/// gradients on the triangle (zero where the mesh has no such set).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct UvAt {
    /// The coordinates of set 0 and set 1.
    pub uv: [[f32; 2]; 2],
    /// `∇u`, `∇v` of each set, in the part's space.
    pub grad: [[Vec3; 2]; 2],
}

/// A slot's mapping prepared for an image: its size across and up, the turn, the repeats and the
/// offset.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mapping {
    /// [`PROJECTION_UV`] … [`PROJECTION_SPHERICAL`].
    pub projection: u32,
    /// The slot's axis.
    pub axis: u32,
    /// UV: the set (0 or 1).
    pub uv_set: usize,
    /// One repeat across, mm.
    pub width: f32,
    /// One repeat up, mm (the width over the image's aspect).
    pub height: f32,
    /// `cos` and `sin` of the turn.
    pub cos: f32,
    /// See `cos`.
    pub sin: f32,
    /// Repeats along u and v.
    pub repeat: [f32; 2],
    /// Offset along u and v.
    pub offset: [f32; 2],
}

impl Mapping {
    /// The mapping of `slot` for an image of `aspect` = width / height.
    pub fn new(slot: &TextureSlot, aspect: f32) -> Mapping {
        let (sin, cos) = fmath::sin_cos(slot.rotation_deg * fmath::DEG_TO_RAD);
        let aspect = if aspect > 0.0 && aspect.is_finite() {
            aspect
        } else {
            1.0
        };
        Mapping {
            projection: slot.projection,
            axis: slot.axis,
            uv_set: if slot.uv_set == 1 { 1 } else { 0 },
            width: slot.size_mm,
            height: slot.size_mm / aspect,
            cos,
            sin,
            repeat: slot.repeat,
            offset: slot.offset,
        }
    }

    /// `R·(c ⊙ repeat) + offset` (`transformUv`).
    #[inline]
    fn transform(&self, cu: f32, cv: f32) -> (f32, f32) {
        let x = cu * self.repeat[0];
        let y = cv * self.repeat[1];
        (
            (self.cos * x - self.sin * y) + self.offset[0],
            (self.sin * x + self.cos * y) + self.offset[1],
        )
    }

    /// The gradients of the transformed coordinates from those of `(cu, cv)`.
    #[inline]
    fn transform_grad(&self, gu: Vec3, gv: Vec3) -> (Vec3, Vec3) {
        let x = gu * self.repeat[0];
        let y = gv * self.repeat[1];
        (x * self.cos - y * self.sin, x * self.sin + y * self.cos)
    }

    /// A coordinate of the projections (centred by ½).
    #[inline]
    fn centred(&self, cu: f32, cv: f32, gu: Vec3, gv: Vec3, weight: f32) -> Coord {
        let (u, v) = self.transform(cu, cv);
        let (du, dv) = self.transform_grad(gu, gv);
        Coord {
            u: u + 0.5,
            v: v + 0.5,
            weight,
            du,
            dv,
        }
    }

    /// Where the point `p` (part space) with outward normal `n` reads the image; `uv` gives the
    /// UV projection the mesh's coordinates.
    pub fn project(&self, p: Vec3, n: Vec3, uv: &UvAt) -> Projected {
        let none = Coord {
            u: 0.0,
            v: 0.0,
            weight: 0.0,
            du: Vec3::ZERO,
            dv: Vec3::ZERO,
        };
        let one = |c: Coord| Projected {
            coords: [c, none, none],
            count: 1,
        };
        let (w, h) = (self.width, self.height);
        match self.projection {
            PROJECTION_BOX => {
                let weights = box_weights(n);
                let mut coords = [none; 3];
                for (axis, slot) in coords.iter_mut().enumerate() {
                    let (s, t, gs, gt) = box_coords(axis, p, n);
                    *slot =
                        self.centred(s / w, t / h, gs * (1.0 / w), gt * (1.0 / h), weights[axis]);
                }
                Projected { coords, count: 3 }
            }
            PROJECTION_PLANAR => {
                let (a, b) = match self.axis {
                    AXIS_Z => (0, 1),
                    AXIS_X => (1, 2),
                    _ => (0, 2),
                };
                one(self.centred(
                    comp(p, a) / w,
                    comp(p, b) / h,
                    AXES[a] * (1.0 / w),
                    AXES[b] * (1.0 / h),
                    1.0,
                ))
            }
            PROJECTION_CYLINDRICAL | PROJECTION_SPHERICAL => {
                let (si, ti, ai) = section(self.axis);
                let (s, t, a) = (comp(p, si), comp(p, ti), comp(p, ai));
                let (cu, gu) = turns(s, t, AXES[si], AXES[ti]);
                let (cv, gv) = if self.projection == PROJECTION_CYLINDRICAL {
                    (a / h, AXES[ai] * (1.0 / h))
                } else {
                    latitude(p, a, s, t, AXES[ai])
                };
                one(self.centred(cu, cv, gu, gv, 1.0))
            }
            _ => {
                // PROJECTION_UV and anything unknown (the reader refuses unknown codes).
                let set = self.uv_set;
                let [cu, cv] = uv.uv[set];
                let (u, v) = self.transform(cu, cv);
                let (du, dv) = self.transform_grad(uv.grad[set][0], uv.grad[set][1]);
                one(Coord {
                    u,
                    v,
                    weight: 1.0,
                    du,
                    dv,
                })
            }
        }
    }

    /// True for the UV projection.
    pub fn is_uv(&self) -> bool {
        self.projection == PROJECTION_UV
    }

    /// True for a box projection.
    pub fn is_box(&self) -> bool {
        self.projection == PROJECTION_BOX
    }

    /// True for a planar projection.
    pub fn is_planar(&self) -> bool {
        self.projection == PROJECTION_PLANAR
    }
}

/// How much each axis counts in a box projection: `|n_i|⁴` normalised (`boxWeights`; a zero
/// normal takes Z).
pub fn box_weights(n: Vec3) -> [f32; 3] {
    let p = |v: f32| {
        let v2 = v * v;
        v2 * v2
    };
    let w = [p(n.x), p(n.y), p(n.z)];
    let s = (w[0] + w[1]) + w[2];
    if s > 1.0e-12 {
        [w[0] / s, w[1] / s, w[2] / s]
    } else {
        [0.0, 0.0, 1.0]
    }
}

/// The box coordinates of axis `axis` (0 X, 1 Y, 2 Z) and their gradients (`boxCoords`).
fn box_coords(axis: usize, p: Vec3, n: Vec3) -> (f32, f32, Vec3, Vec3) {
    match axis {
        2 => {
            let k = if n.z >= 0.0 { 1.0 } else { -1.0 };
            (k * p.x, p.y, AXES[0] * k, AXES[1])
        }
        1 => {
            let k = if n.y <= 0.0 { 1.0 } else { -1.0 };
            (k * p.x, p.z, AXES[0] * k, AXES[2])
        }
        _ => {
            let k = if n.x >= 0.0 { 1.0 } else { -1.0 };
            (k * p.y, p.z, AXES[1] * k, AXES[2])
        }
    }
}

/// Turns about an axis from the cross-section coordinates `(s, t)`: `−½ … ½`, 0 facing −T,
/// growing counter-clockwise seen from +axis (`turnsAbout`), and its gradient.
fn turns(s: f32, t: f32, es: Vec3, et: Vec3) -> (f32, Vec3) {
    let theta = fmath::atan2(t, s);
    let mut c = (theta + fmath::FRAC_PI_2) / fmath::TAU;
    c -= (c + 0.5).floor();
    let r2 = s * s + t * t;
    let g = if r2 > 1.0e-20 {
        (et * s - es * t) * (1.0 / (fmath::TAU * r2))
    } else {
        Vec3::ZERO
    };
    (c, g)
}

/// The latitude of the spherical projection, `asin(a / |p|) / π`, and its gradient.
fn latitude(p: Vec3, a: f32, s: f32, t: f32, ea: Vec3) -> (f32, Vec3) {
    let r = p.length();
    if r <= 1.0e-12 {
        return (0.0, Vec3::ZERO);
    }
    let lat = fmath::asin((a / r).clamp(-1.0, 1.0)) * fmath::FRAC_1_PI;
    let rho = (s * s + t * t).sqrt();
    let g = if rho > 1.0e-12 {
        (ea - p * (a / (r * r))) * (1.0 / (fmath::PI * rho))
    } else {
        Vec3::ZERO
    };
    (lat, g)
}

/// A label prepared for reading: its frame, size, reach and finish.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LabelFrame {
    /// Its centre (part space).
    pub origin: Vec3,
    /// `u / width`: `s = (p − origin)·su + ½`.
    pub su: Vec3,
    /// `v / height`.
    pub tv: Vec3,
    /// Its plane's normal.
    pub normal: Vec3,
    /// Its reach in front of and behind its plane.
    pub depth: f32,
}

impl LabelFrame {
    /// The frame of a label of the block.
    pub fn new(l: &super::Label) -> LabelFrame {
        LabelFrame {
            origin: l.origin,
            su: l.u * (1.0 / l.width_mm),
            tv: l.v * (1.0 / l.height_mm),
            normal: l.normal,
            depth: l.depth_mm,
        }
    }

    /// The label's `(s, t)` (t up) at `p` before the test of its rectangle.
    #[inline]
    pub fn coords(&self, p: Vec3) -> (f32, f32) {
        let d = p - self.origin;
        (d.dot(self.su) + 0.5, d.dot(self.tv) + 0.5)
    }

    /// True where the label reaches `p` with outward normal `n`: within its rectangle
    /// (`|s − ½| ≤ ½`, `|t − ½| ≤ ½` for the `(s, t)` given), within its depth of its plane and
    /// on a surface facing its side (`n · normal > 0`; `labelCoords`).
    #[inline]
    pub fn covers(&self, p: Vec3, n: Vec3, s: f32, t: f32) -> bool {
        (0.0..=1.0).contains(&s)
            && (0.0..=1.0).contains(&t)
            && (p - self.origin).dot(self.normal).abs() <= self.depth
            && n.dot(self.normal) > 0.0
    }
}

//! The scalar reference implementation: plain arrays and one IEEE operation per lane.
//!
//! Always compiled. It is the oracle every accelerated path is tested against, and the path used
//! on targets without a SIMD implementation (RISC-V, wasm without `simd128`).

use super::{max_f32, min_f32, Mask, Vector};
use std::ops::{Add, BitAnd, BitOr, Div, Mul, Not, Sub};

/// Applies `op` with the fixed reduction tree of the module documentation to four values.
#[inline(always)]
fn tree4(a: [f32; 4], op: fn(f32, f32) -> f32) -> f32 {
    op(op(a[0], a[2]), op(a[1], a[3]))
}

/// Applies `op` with the fixed reduction tree of the module documentation to eight values.
#[inline(always)]
fn tree8(a: [f32; 8], op: fn(f32, f32) -> f32) -> f32 {
    tree4(
        [
            op(a[0], a[4]),
            op(a[1], a[5]),
            op(a[2], a[6]),
            op(a[3], a[7]),
        ],
        op,
    )
}

macro_rules! scalar_vector {
    ($vector:ident, $mask:ident, $lanes:literal, $tree:ident, $what:literal) => {
        #[doc = concat!("Scalar reference vector of ", $what, " `f32` lanes.")]
        #[derive(Clone, Copy, Debug, PartialEq)]
        pub struct $vector(pub [f32; $lanes]);

        #[doc = concat!("Mask of [`", stringify!($vector), "`]: one `bool` per lane.")]
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub struct $mask(pub [bool; $lanes]);

        impl $vector {
            #[inline(always)]
            fn map2(self, o: Self, f: impl Fn(f32, f32) -> f32) -> Self {
                $vector(std::array::from_fn(|i| f(self.0[i], o.0[i])))
            }

            #[inline(always)]
            fn compare(self, o: Self, f: impl Fn(f32, f32) -> bool) -> $mask {
                $mask(std::array::from_fn(|i| f(self.0[i], o.0[i])))
            }
        }

        impl Add for $vector {
            type Output = Self;
            #[inline(always)]
            fn add(self, o: Self) -> Self {
                self.map2(o, |a, b| a + b)
            }
        }

        impl Sub for $vector {
            type Output = Self;
            #[inline(always)]
            fn sub(self, o: Self) -> Self {
                self.map2(o, |a, b| a - b)
            }
        }

        impl Mul for $vector {
            type Output = Self;
            #[inline(always)]
            fn mul(self, o: Self) -> Self {
                self.map2(o, |a, b| a * b)
            }
        }

        impl Div for $vector {
            type Output = Self;
            #[inline(always)]
            fn div(self, o: Self) -> Self {
                self.map2(o, |a, b| a / b)
            }
        }

        impl BitAnd for $mask {
            type Output = Self;
            #[inline(always)]
            fn bitand(self, o: Self) -> Self {
                $mask(std::array::from_fn(|i| self.0[i] & o.0[i]))
            }
        }

        impl BitOr for $mask {
            type Output = Self;
            #[inline(always)]
            fn bitor(self, o: Self) -> Self {
                $mask(std::array::from_fn(|i| self.0[i] | o.0[i]))
            }
        }

        impl Not for $mask {
            type Output = Self;
            #[inline(always)]
            fn not(self) -> Self {
                $mask(self.0.map(|b| !b))
            }
        }

        impl Mask for $mask {
            const LANES: usize = $lanes;

            #[inline(always)]
            fn bitmask(self) -> u32 {
                self.0
                    .iter()
                    .enumerate()
                    .fold(0, |bits, (i, &set)| bits | (u32::from(set) << i))
            }
        }

        impl Vector for $vector {
            const LANES: usize = $lanes;
            type Array = [f32; $lanes];
            type Mask = $mask;

            #[inline(always)]
            fn splat(v: f32) -> Self {
                $vector([v; $lanes])
            }

            #[inline(always)]
            fn load(src: &[f32; $lanes]) -> Self {
                $vector(*src)
            }

            #[inline(always)]
            fn store(self, dst: &mut [f32; $lanes]) {
                *dst = self.0;
            }

            #[inline(always)]
            fn min(self, o: Self) -> Self {
                self.map2(o, min_f32)
            }

            #[inline(always)]
            fn max(self, o: Self) -> Self {
                self.map2(o, max_f32)
            }

            #[inline(always)]
            fn lt(self, o: Self) -> $mask {
                self.compare(o, |a, b| a < b)
            }

            #[inline(always)]
            fn le(self, o: Self) -> $mask {
                self.compare(o, |a, b| a <= b)
            }

            #[inline(always)]
            fn gt(self, o: Self) -> $mask {
                self.compare(o, |a, b| a > b)
            }

            #[inline(always)]
            fn ge(self, o: Self) -> $mask {
                self.compare(o, |a, b| a >= b)
            }

            #[inline(always)]
            fn eq(self, o: Self) -> $mask {
                self.compare(o, |a, b| a == b)
            }

            #[inline(always)]
            fn select(mask: $mask, t: Self, f: Self) -> Self {
                $vector(std::array::from_fn(
                    |i| if mask.0[i] { t.0[i] } else { f.0[i] },
                ))
            }

            #[inline(always)]
            fn reduce_min(self) -> f32 {
                $tree(self.0, min_f32)
            }

            #[inline(always)]
            fn reduce_max(self) -> f32 {
                $tree(self.0, max_f32)
            }
        }
    };
}

scalar_vector!(F32x4, M32x4, 4, tree4, "four");
scalar_vector!(F32x8, M32x8, 8, tree8, "eight");

//! `wasm32` path: the `simd128` proposal, compiled in when the module is built with
//! `-C target-feature=+simd128`.
//!
//! `f32x4.min`/`max` propagate NaNs, so [`Vector::min`]/[`Vector::max`] use the "pseudo" forms
//! with swapped operands: `pmin(b, a)` is exactly `if a < b { a } else { b }` and `pmax(b, a)`
//! is exactly `if a > b { a } else { b }`.

use super::{Backend, Mask, Pair, Vector};
use core::arch::wasm32::*;
use std::ops::{Add, BitAnd, BitOr, Div, Mul, Not, Sub};

/// Four `f32` lanes in a `v128`.
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct F32x4(v128);

/// Mask of [`F32x4`]: all-ones or all-zeros lanes in a `v128`.
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct M32x4(v128);

impl Add for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn add(self, o: Self) -> Self {
        F32x4(f32x4_add(self.0, o.0))
    }
}

impl Sub for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn sub(self, o: Self) -> Self {
        F32x4(f32x4_sub(self.0, o.0))
    }
}

impl Mul for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn mul(self, o: Self) -> Self {
        F32x4(f32x4_mul(self.0, o.0))
    }
}

impl Div for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn div(self, o: Self) -> Self {
        F32x4(f32x4_div(self.0, o.0))
    }
}

impl BitAnd for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn bitand(self, o: Self) -> Self {
        M32x4(v128_and(self.0, o.0))
    }
}

impl BitOr for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn bitor(self, o: Self) -> Self {
        M32x4(v128_or(self.0, o.0))
    }
}

impl Not for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn not(self) -> Self {
        M32x4(v128_not(self.0))
    }
}

impl Mask for M32x4 {
    const LANES: usize = 4;

    #[inline(always)]
    fn bitmask(self) -> u32 {
        u32::from(i32x4_bitmask(self.0))
    }

    #[inline(always)]
    fn and_not(self, o: Self) -> Self {
        M32x4(v128_andnot(self.0, o.0))
    }
}

impl Vector for F32x4 {
    const LANES: usize = 4;
    type Array = [f32; 4];
    type Mask = M32x4;

    #[inline(always)]
    fn splat(v: f32) -> Self {
        F32x4(f32x4_splat(v))
    }

    #[inline(always)]
    fn load(src: &[f32; 4]) -> Self {
        // SAFETY: `src` points to 16 readable bytes; `v128.load` has no alignment requirement.
        F32x4(unsafe { v128_load(src.as_ptr().cast::<v128>()) })
    }

    #[inline(always)]
    fn store(self, dst: &mut [f32; 4]) {
        // SAFETY: `dst` points to 16 writable bytes; `v128.store` has no alignment requirement.
        unsafe { v128_store(dst.as_mut_ptr().cast::<v128>(), self.0) }
    }

    #[inline(always)]
    fn min(self, o: Self) -> Self {
        F32x4(f32x4_pmin(o.0, self.0))
    }

    #[inline(always)]
    fn max(self, o: Self) -> Self {
        F32x4(f32x4_pmax(o.0, self.0))
    }

    #[inline(always)]
    fn lt(self, o: Self) -> M32x4 {
        M32x4(f32x4_lt(self.0, o.0))
    }

    #[inline(always)]
    fn le(self, o: Self) -> M32x4 {
        M32x4(f32x4_le(self.0, o.0))
    }

    #[inline(always)]
    fn gt(self, o: Self) -> M32x4 {
        M32x4(f32x4_gt(self.0, o.0))
    }

    #[inline(always)]
    fn ge(self, o: Self) -> M32x4 {
        M32x4(f32x4_ge(self.0, o.0))
    }

    #[inline(always)]
    fn eq(self, o: Self) -> M32x4 {
        M32x4(f32x4_eq(self.0, o.0))
    }

    #[inline(always)]
    fn select(mask: M32x4, t: Self, f: Self) -> Self {
        F32x4(v128_bitselect(t.0, f.0, mask.0))
    }

    #[inline(always)]
    fn reduce_min(self) -> f32 {
        // [a b c d] -> [min(a,c) min(b,d) ..] -> min(min(a,c), min(b,d)).
        let m = self.min(F32x4(i32x4_shuffle::<2, 3, 0, 1>(self.0, self.0)));
        let r = m.min(F32x4(i32x4_shuffle::<1, 0, 3, 2>(m.0, m.0)));
        f32x4_extract_lane::<0>(r.0)
    }

    #[inline(always)]
    fn reduce_max(self) -> f32 {
        let m = self.max(F32x4(i32x4_shuffle::<2, 3, 0, 1>(self.0, self.0)));
        let r = m.max(F32x4(i32x4_shuffle::<1, 0, 3, 2>(m.0, m.0)));
        f32x4_extract_lane::<0>(r.0)
    }
}

/// The `simd128` backend: four lanes in one `v128`, eight in two.
#[derive(Clone, Copy, Debug)]
pub struct Simd128;

impl Backend for Simd128 {
    type V4 = F32x4;
    type V8 = Pair<F32x4>;
}

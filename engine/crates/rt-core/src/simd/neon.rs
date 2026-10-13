//! `aarch64` path: NEON (Advanced SIMD), part of the baseline of the architecture.
//!
//! NEON's own `fmin`/`fmax` propagate NaNs, so [`Vector::min`]/[`Vector::max`] are built from an
//! ordered compare and a bit select to get exactly `if a < b { a } else { b }`. Plain `vmulq` /
//! `vaddq` are used (never `vfmaq`), so nothing is fused.

use super::{Backend, Mask, Pair, Vector};
use core::arch::aarch64::*;
use std::ops::{Add, BitAnd, BitOr, Div, Mul, Not, Sub};

/// Evaluates an expression made of register-only NEON intrinsics.
macro_rules! neon {
    ($e:expr) => {
        // SAFETY: this module is only compiled for `aarch64` with the `neon` target feature,
        // which is part of the architecture's baseline, so these register-only intrinsics are
        // always sound to execute.
        unsafe { $e }
    };
}

/// Four `f32` lanes in a NEON register.
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct F32x4(float32x4_t);

/// Mask of [`F32x4`]: all-ones or all-zeros `u32` lanes.
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct M32x4(uint32x4_t);

/// Lane `i` holds bit `i`: the weights that turn a mask into a bit mask.
const LANE_BITS: [u32; 4] = [1, 2, 4, 8];

impl Add for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn add(self, o: Self) -> Self {
        F32x4(neon!(vaddq_f32(self.0, o.0)))
    }
}

impl Sub for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn sub(self, o: Self) -> Self {
        F32x4(neon!(vsubq_f32(self.0, o.0)))
    }
}

impl Mul for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn mul(self, o: Self) -> Self {
        F32x4(neon!(vmulq_f32(self.0, o.0)))
    }
}

impl Div for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn div(self, o: Self) -> Self {
        F32x4(neon!(vdivq_f32(self.0, o.0)))
    }
}

impl BitAnd for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn bitand(self, o: Self) -> Self {
        M32x4(neon!(vandq_u32(self.0, o.0)))
    }
}

impl BitOr for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn bitor(self, o: Self) -> Self {
        M32x4(neon!(vorrq_u32(self.0, o.0)))
    }
}

impl Not for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn not(self) -> Self {
        M32x4(neon!(vmvnq_u32(self.0)))
    }
}

impl Mask for M32x4 {
    const LANES: usize = 4;

    #[inline(always)]
    fn bitmask(self) -> u32 {
        // SAFETY: NEON is baseline on aarch64 and `LANE_BITS` is a valid array of four `u32`;
        // `vld1q` has no alignment requirement.
        let weights = unsafe { vld1q_u32(LANE_BITS.as_ptr()) };
        neon!(vaddvq_u32(vandq_u32(self.0, weights)))
    }

    #[inline(always)]
    fn and_not(self, o: Self) -> Self {
        M32x4(neon!(vbicq_u32(self.0, o.0)))
    }
}

impl Vector for F32x4 {
    const LANES: usize = 4;
    type Array = [f32; 4];
    type Mask = M32x4;

    #[inline(always)]
    fn splat(v: f32) -> Self {
        F32x4(neon!(vdupq_n_f32(v)))
    }

    #[inline(always)]
    fn load(src: &[f32; 4]) -> Self {
        // SAFETY: NEON is baseline on aarch64 and `src` is a valid reference to four floats;
        // `vld1q` has no alignment requirement.
        F32x4(unsafe { vld1q_f32(src.as_ptr()) })
    }

    #[inline(always)]
    fn store(self, dst: &mut [f32; 4]) {
        // SAFETY: NEON is baseline on aarch64 and `dst` is a valid, exclusive reference to four
        // floats; `vst1q` has no alignment requirement.
        unsafe { vst1q_f32(dst.as_mut_ptr(), self.0) }
    }

    #[inline(always)]
    fn min(self, o: Self) -> Self {
        F32x4(neon!(vbslq_f32(vcltq_f32(self.0, o.0), self.0, o.0)))
    }

    #[inline(always)]
    fn max(self, o: Self) -> Self {
        F32x4(neon!(vbslq_f32(vcgtq_f32(self.0, o.0), self.0, o.0)))
    }

    #[inline(always)]
    fn lt(self, o: Self) -> M32x4 {
        M32x4(neon!(vcltq_f32(self.0, o.0)))
    }

    #[inline(always)]
    fn le(self, o: Self) -> M32x4 {
        M32x4(neon!(vcleq_f32(self.0, o.0)))
    }

    #[inline(always)]
    fn gt(self, o: Self) -> M32x4 {
        M32x4(neon!(vcgtq_f32(self.0, o.0)))
    }

    #[inline(always)]
    fn ge(self, o: Self) -> M32x4 {
        M32x4(neon!(vcgeq_f32(self.0, o.0)))
    }

    #[inline(always)]
    fn eq(self, o: Self) -> M32x4 {
        M32x4(neon!(vceqq_f32(self.0, o.0)))
    }

    #[inline(always)]
    fn select(mask: M32x4, t: Self, f: Self) -> Self {
        F32x4(neon!(vbslq_f32(mask.0, t.0, f.0)))
    }

    #[inline(always)]
    fn reduce_min(self) -> f32 {
        // [a b c d] -> [min(a,c) min(b,d) ..] -> min(min(a,c), min(b,d)).
        let m = self.min(F32x4(neon!(vextq_f32::<2>(self.0, self.0))));
        neon!(vgetq_lane_f32::<0>(m.min(F32x4(vrev64q_f32(m.0))).0))
    }

    #[inline(always)]
    fn reduce_max(self) -> f32 {
        let m = self.max(F32x4(neon!(vextq_f32::<2>(self.0, self.0))));
        neon!(vgetq_lane_f32::<0>(m.max(F32x4(vrev64q_f32(m.0))).0))
    }
}

/// The NEON backend: four lanes in one register, eight in two.
#[derive(Clone, Copy, Debug)]
pub struct Neon;

impl Backend for Neon {
    type V4 = F32x4;
    type V8 = Pair<F32x4>;
}

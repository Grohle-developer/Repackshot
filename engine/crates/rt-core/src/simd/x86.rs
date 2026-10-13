//! `x86_64` paths: SSE2 (baseline of the architecture) and AVX2 (detected at run time).

use super::{Backend, Kernel, Mask, Pair, Vector};
use core::arch::x86_64::*;
use std::ops::{Add, BitAnd, BitOr, Div, Mul, Not, Sub};

/// Evaluates an expression made of register-only SSE/SSE2 intrinsics.
macro_rules! sse {
    ($e:expr) => {
        // SAFETY: SSE and SSE2 are part of the x86_64 baseline: every CPU that runs x86_64 code
        // has them, so these register-only intrinsics are always sound to execute.
        unsafe { $e }
    };
}

/// Evaluates an expression made of register-only AVX intrinsics.
macro_rules! avx {
    ($e:expr) => {
        // SAFETY: AVX values are only created inside `run_avx2`, which `Isa::dispatch` enters
        // after `is_x86_feature_detected!("avx2")` returned true, so these register-only
        // intrinsics run on a CPU that has AVX and AVX2.
        unsafe { $e }
    };
}

/// Four `f32` lanes in an SSE register.
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct F32x4(__m128);

/// Mask of [`F32x4`]: all-ones or all-zeros lanes in an SSE register.
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct M32x4(__m128);

impl Add for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn add(self, o: Self) -> Self {
        F32x4(sse!(_mm_add_ps(self.0, o.0)))
    }
}

impl Sub for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn sub(self, o: Self) -> Self {
        F32x4(sse!(_mm_sub_ps(self.0, o.0)))
    }
}

impl Mul for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn mul(self, o: Self) -> Self {
        F32x4(sse!(_mm_mul_ps(self.0, o.0)))
    }
}

impl Div for F32x4 {
    type Output = Self;
    #[inline(always)]
    fn div(self, o: Self) -> Self {
        F32x4(sse!(_mm_div_ps(self.0, o.0)))
    }
}

impl BitAnd for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn bitand(self, o: Self) -> Self {
        M32x4(sse!(_mm_and_ps(self.0, o.0)))
    }
}

impl BitOr for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn bitor(self, o: Self) -> Self {
        M32x4(sse!(_mm_or_ps(self.0, o.0)))
    }
}

impl Not for M32x4 {
    type Output = Self;
    #[inline(always)]
    fn not(self) -> Self {
        M32x4(sse!(_mm_xor_ps(
            self.0,
            _mm_castsi128_ps(_mm_set1_epi32(-1))
        )))
    }
}

impl Mask for M32x4 {
    const LANES: usize = 4;

    #[inline(always)]
    fn bitmask(self) -> u32 {
        sse!(_mm_movemask_ps(self.0)) as u32
    }

    #[inline(always)]
    fn and_not(self, o: Self) -> Self {
        M32x4(sse!(_mm_andnot_ps(o.0, self.0)))
    }
}

impl Vector for F32x4 {
    const LANES: usize = 4;
    type Array = [f32; 4];
    type Mask = M32x4;

    #[inline(always)]
    fn splat(v: f32) -> Self {
        F32x4(sse!(_mm_set1_ps(v)))
    }

    #[inline(always)]
    fn load(src: &[f32; 4]) -> Self {
        // SAFETY: SSE is baseline on x86_64 and `src` is a valid reference to four floats;
        // `loadu` has no alignment requirement.
        F32x4(unsafe { _mm_loadu_ps(src.as_ptr()) })
    }

    #[inline(always)]
    fn store(self, dst: &mut [f32; 4]) {
        // SAFETY: SSE is baseline on x86_64 and `dst` is a valid, exclusive reference to four
        // floats; `storeu` has no alignment requirement.
        unsafe { _mm_storeu_ps(dst.as_mut_ptr(), self.0) }
    }

    #[inline(always)]
    fn min(self, o: Self) -> Self {
        // `minps` is exactly `if a < b { a } else { b }`.
        F32x4(sse!(_mm_min_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn max(self, o: Self) -> Self {
        // `maxps` is exactly `if a > b { a } else { b }`.
        F32x4(sse!(_mm_max_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn lt(self, o: Self) -> M32x4 {
        M32x4(sse!(_mm_cmplt_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn le(self, o: Self) -> M32x4 {
        M32x4(sse!(_mm_cmple_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn gt(self, o: Self) -> M32x4 {
        M32x4(sse!(_mm_cmpgt_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn ge(self, o: Self) -> M32x4 {
        M32x4(sse!(_mm_cmpge_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn eq(self, o: Self) -> M32x4 {
        M32x4(sse!(_mm_cmpeq_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn select(mask: M32x4, t: Self, f: Self) -> Self {
        F32x4(sse!(_mm_or_ps(
            _mm_and_ps(mask.0, t.0),
            _mm_andnot_ps(mask.0, f.0)
        )))
    }

    #[inline(always)]
    fn reduce_min(self) -> f32 {
        // [a b c d] -> [min(a,c) min(b,d) ..] -> min(min(a,c), min(b,d)).
        let v = self.0;
        sse!({
            let m = _mm_min_ps(v, _mm_shuffle_ps::<0x4E>(v, v));
            _mm_cvtss_f32(_mm_min_ps(m, _mm_shuffle_ps::<0xB1>(m, m)))
        })
    }

    #[inline(always)]
    fn reduce_max(self) -> f32 {
        let v = self.0;
        sse!({
            let m = _mm_max_ps(v, _mm_shuffle_ps::<0x4E>(v, v));
            _mm_cvtss_f32(_mm_max_ps(m, _mm_shuffle_ps::<0xB1>(m, m)))
        })
    }
}

/// The SSE2 backend: four lanes in one register, eight in two.
#[derive(Clone, Copy, Debug)]
pub struct Sse2;

impl Backend for Sse2 {
    type V4 = F32x4;
    type V8 = Pair<F32x4>;
}

// ---------------------------------------------------------------------------------------------
// AVX2. The types below are private to the `simd` module and only ever created inside
// `run_avx2`, which `Isa::dispatch` calls after `is_x86_feature_detected!("avx2")` returned
// true. That is the safety argument of every `unsafe` block that runs an AVX instruction.
// ---------------------------------------------------------------------------------------------

/// Eight `f32` lanes in an AVX register. Only exists inside [`run_avx2`].
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct F32x8Avx(__m256);

/// Mask of [`F32x8Avx`]. Only exists inside [`run_avx2`].
#[derive(Clone, Copy, Debug)]
#[repr(transparent)]
pub struct M32x8Avx(__m256);

impl Add for F32x8Avx {
    type Output = Self;
    #[inline(always)]
    fn add(self, o: Self) -> Self {
        F32x8Avx(avx!(_mm256_add_ps(self.0, o.0)))
    }
}

impl Sub for F32x8Avx {
    type Output = Self;
    #[inline(always)]
    fn sub(self, o: Self) -> Self {
        F32x8Avx(avx!(_mm256_sub_ps(self.0, o.0)))
    }
}

impl Mul for F32x8Avx {
    type Output = Self;
    #[inline(always)]
    fn mul(self, o: Self) -> Self {
        F32x8Avx(avx!(_mm256_mul_ps(self.0, o.0)))
    }
}

impl Div for F32x8Avx {
    type Output = Self;
    #[inline(always)]
    fn div(self, o: Self) -> Self {
        F32x8Avx(avx!(_mm256_div_ps(self.0, o.0)))
    }
}

impl BitAnd for M32x8Avx {
    type Output = Self;
    #[inline(always)]
    fn bitand(self, o: Self) -> Self {
        M32x8Avx(avx!(_mm256_and_ps(self.0, o.0)))
    }
}

impl BitOr for M32x8Avx {
    type Output = Self;
    #[inline(always)]
    fn bitor(self, o: Self) -> Self {
        M32x8Avx(avx!(_mm256_or_ps(self.0, o.0)))
    }
}

impl Not for M32x8Avx {
    type Output = Self;
    #[inline(always)]
    fn not(self) -> Self {
        M32x8Avx(avx!(_mm256_xor_ps(
            self.0,
            _mm256_castsi256_ps(_mm256_set1_epi32(-1))
        )))
    }
}

impl Mask for M32x8Avx {
    const LANES: usize = 8;

    #[inline(always)]
    fn bitmask(self) -> u32 {
        avx!(_mm256_movemask_ps(self.0)) as u32
    }

    #[inline(always)]
    fn and_not(self, o: Self) -> Self {
        M32x8Avx(avx!(_mm256_andnot_ps(o.0, self.0)))
    }
}

impl F32x8Avx {
    /// Lanes 0..4 and 4..8 as SSE vectors.
    #[inline(always)]
    fn halves(self) -> (F32x4, F32x4) {
        let v = self.0;
        avx!((
            F32x4(_mm256_castps256_ps128(v)),
            F32x4(_mm256_extractf128_ps::<1>(v))
        ))
    }
}

impl Vector for F32x8Avx {
    const LANES: usize = 8;
    type Array = [f32; 8];
    type Mask = M32x8Avx;

    #[inline(always)]
    fn splat(v: f32) -> Self {
        F32x8Avx(avx!(_mm256_set1_ps(v)))
    }

    #[inline(always)]
    fn load(src: &[f32; 8]) -> Self {
        // SAFETY: AVX is present (see the note above `F32x8Avx`) and `src` is a valid reference
        // to eight floats; `loadu` has no alignment requirement.
        F32x8Avx(unsafe { _mm256_loadu_ps(src.as_ptr()) })
    }

    #[inline(always)]
    fn store(self, dst: &mut [f32; 8]) {
        // SAFETY: AVX is present (see the note above `F32x8Avx`) and `dst` is a valid, exclusive
        // reference to eight floats; `storeu` has no alignment requirement.
        unsafe { _mm256_storeu_ps(dst.as_mut_ptr(), self.0) }
    }

    #[inline(always)]
    fn min(self, o: Self) -> Self {
        // Same semantics as `minps`: `if a < b { a } else { b }`.
        F32x8Avx(avx!(_mm256_min_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn max(self, o: Self) -> Self {
        F32x8Avx(avx!(_mm256_max_ps(self.0, o.0)))
    }

    #[inline(always)]
    fn lt(self, o: Self) -> M32x8Avx {
        M32x8Avx(avx!(_mm256_cmp_ps::<_CMP_LT_OQ>(self.0, o.0)))
    }

    #[inline(always)]
    fn le(self, o: Self) -> M32x8Avx {
        M32x8Avx(avx!(_mm256_cmp_ps::<_CMP_LE_OQ>(self.0, o.0)))
    }

    #[inline(always)]
    fn gt(self, o: Self) -> M32x8Avx {
        M32x8Avx(avx!(_mm256_cmp_ps::<_CMP_GT_OQ>(self.0, o.0)))
    }

    #[inline(always)]
    fn ge(self, o: Self) -> M32x8Avx {
        M32x8Avx(avx!(_mm256_cmp_ps::<_CMP_GE_OQ>(self.0, o.0)))
    }

    #[inline(always)]
    fn eq(self, o: Self) -> M32x8Avx {
        M32x8Avx(avx!(_mm256_cmp_ps::<_CMP_EQ_OQ>(self.0, o.0)))
    }

    #[inline(always)]
    fn select(mask: M32x8Avx, t: Self, f: Self) -> Self {
        // `blendv` picks by the sign bit; mask lanes are all-ones or all-zeros.
        F32x8Avx(avx!(_mm256_blendv_ps(f.0, t.0, mask.0)))
    }

    #[inline(always)]
    fn reduce_min(self) -> f32 {
        let (lo, hi) = self.halves();
        lo.min(hi).reduce_min()
    }

    #[inline(always)]
    fn reduce_max(self) -> f32 {
        let (lo, hi) = self.halves();
        lo.max(hi).reduce_max()
    }
}

/// The AVX2 backend: four lanes in a (VEX encoded) SSE register, eight in one AVX register.
#[derive(Clone, Copy, Debug)]
pub struct Avx2;

impl Backend for Avx2 {
    type V4 = F32x4;
    type V8 = F32x8Avx;
}

/// Runs `kernel` with the AVX2 backend. The kernel is inlined here and compiled with AVX2.
///
/// Callers must have checked that the CPU supports AVX2 (`Isa::dispatch` does).
#[target_feature(enable = "avx2")]
pub fn run_avx2<K: Kernel>(kernel: K) -> K::Output {
    kernel.run::<Avx2>()
}

//! Portable SIMD: 4- and 8-lane `f32` vectors with a scalar reference implementation.
//!
//! `std::simd` is nightly only, so the engine has its own small abstraction over the stable
//! `core::arch` intrinsics:
//!
//! | Path | Where | 4 lanes ([`Backend::V4`]) | 8 lanes ([`Backend::V8`]) |
//! |------|-------|---------------------------|---------------------------|
//! | [`Isa::Scalar`] | everywhere (the oracle) | [`scalar::F32x4`] | [`scalar::F32x8`] |
//! | [`Isa::Sse2`] | `x86_64` (baseline) | `__m128` | two `__m128` ([`Pair`]) |
//! | [`Isa::Avx2`] | `x86_64`, detected at run time | `__m128` (VEX encoded) | `__m256` |
//! | [`Isa::Neon`] | `aarch64` | `float32x4_t` | two `float32x4_t` |
//! | [`Isa::Simd128`] | `wasm32` built with `+simd128` | `v128` | two `v128` |
//!
//! [`F32x4`] and [`F32x8`] name the best path that is known at compile time (SSE2, NEON,
//! `simd128` or scalar). Every other configuration (RISC-V, wasm without `simd128`, ...) uses the
//! scalar types.
//!
//! # Bit-exact by construction
//!
//! Every operation is specified so that all paths return the same bits (NaN payloads aside,
//! which IEEE 754 leaves open and wasm makes non-deterministic):
//!
//! * `+ - * /` are single IEEE operations, correctly rounded on every path.
//! * [`Vector::mul_add`] is **not fused**: it is `a * b + c` with two roundings, because a fused
//!   multiply-add only exists on some paths and would change the bits.
//! * [`Vector::min`] is `if a < b { a } else { b }` and [`Vector::max`] is
//!   `if a > b { a } else { b }`, the semantics of x86 `minps`/`maxps`. They return one of their
//!   operands unchanged; a NaN in `a` yields `b`, which the BVH slab test relies on. NEON builds
//!   them from a compare and a bit select, wasm from `pmin`/`pmax` with swapped operands.
//! * Comparisons are ordered (false when either side is NaN) and give all-ones/all-zeros lanes.
//! * [`Vector::reduce_min`] / [`Vector::reduce_max`] use one fixed reduction tree
//!   (`[a0..a7]` → `[op(a0, a4) .. op(a3, a7)]` → `op(op(m0, m2), op(m1, m3))`), so `-0`/`+0`
//!   ties and NaNs resolve identically everywhere.
//!
//! The tests run every operation of every path available on the machine against the scalar
//! types on random and special inputs and compare the bits.
//!
//! # Dispatch
//!
//! AVX2 cannot be assumed on `x86_64`, so it is chosen at run time: [`Isa::detect`] asks the CPU
//! (`is_x86_feature_detected!`, a CPUID query cached by `std`, not an OS service), and
//! [`Isa::dispatch`] enters a [`Kernel`] **once per call** through a single
//! `#[target_feature(enable = "avx2")]` function. Everything below that function is generic over
//! [`Backend`] and `#[inline(always)]`, so it is compiled for AVX2 and the 256-bit intrinsics
//! inline. The AVX2 vector type is private to this module: it cannot be created outside a
//! dispatched kernel. Requesting a path the machine lacks falls back to the scalar backend, so
//! [`Isa::dispatch`] is safe for any [`Isa`] value. SSE2, NEON and `simd128` are compile-time
//! features of their targets and need no detection.
//!
//! This is the only module of `rt-core` allowed to use `unsafe`; every block carries a
//! `// SAFETY:` comment.

#![deny(clippy::undocumented_unsafe_blocks)]

use std::fmt::Debug;
use std::ops::{Add, BitAnd, BitOr, Div, Mul, Not, Sub};

pub mod scalar;

#[cfg(target_arch = "x86_64")]
mod x86;

#[cfg(all(target_arch = "aarch64", target_feature = "neon"))]
mod neon;

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod wasm;

#[cfg(test)]
mod tests;

/// Lane-wise `f32` operations shared by every vector type.
pub trait Vector:
    Copy + Debug + Add<Output = Self> + Sub<Output = Self> + Mul<Output = Self> + Div<Output = Self>
{
    /// Number of lanes.
    const LANES: usize;
    /// A plain array with one `f32` per lane (`[f32; LANES]`).
    type Array: Copy + Default + Debug + AsRef<[f32]> + AsMut<[f32]>;
    /// The mask produced by comparisons.
    type Mask: Mask;

    /// Every lane set to `v`.
    fn splat(v: f32) -> Self;
    /// Loads the lanes from an array (no alignment requirement).
    fn load(src: &Self::Array) -> Self;
    /// Stores the lanes into an array (no alignment requirement).
    fn store(self, dst: &mut Self::Array);
    /// Lane-wise `if a < b { a } else { b }`.
    fn min(self, other: Self) -> Self;
    /// Lane-wise `if a > b { a } else { b }`.
    fn max(self, other: Self) -> Self;
    /// Lane-wise `a < b` (false for NaN).
    fn lt(self, other: Self) -> Self::Mask;
    /// Lane-wise `a <= b` (false for NaN).
    fn le(self, other: Self) -> Self::Mask;
    /// Lane-wise `a > b` (false for NaN).
    fn gt(self, other: Self) -> Self::Mask;
    /// Lane-wise `a >= b` (false for NaN).
    fn ge(self, other: Self) -> Self::Mask;
    /// Lane-wise `a == b` (false for NaN).
    fn eq(self, other: Self) -> Self::Mask;
    /// Lane-wise `if mask { if_true } else { if_false }`.
    fn select(mask: Self::Mask, if_true: Self, if_false: Self) -> Self;
    /// Smallest lane, by the fixed reduction tree described in the module documentation.
    fn reduce_min(self) -> f32;
    /// Largest lane, by the fixed reduction tree described in the module documentation.
    fn reduce_max(self) -> f32;

    /// The lanes as an array.
    #[inline(always)]
    fn to_array(self) -> Self::Array {
        let mut out = Self::Array::default();
        self.store(&mut out);
        out
    }

    /// `self * m + a` with **two** roundings (never fused), so every path gives the same bits.
    #[inline(always)]
    fn mul_add(self, m: Self, a: Self) -> Self {
        self * m + a
    }
}

/// A lane mask: every lane is all ones (true) or all zeros (false).
pub trait Mask:
    Copy + Debug + BitAnd<Output = Self> + BitOr<Output = Self> + Not<Output = Self>
{
    /// Number of lanes.
    const LANES: usize;

    /// One bit per lane, lane 0 in bit 0.
    fn bitmask(self) -> u32;

    /// True when at least one lane is set.
    #[inline(always)]
    fn any(self) -> bool {
        self.bitmask() != 0
    }

    /// True when every lane is set.
    #[inline(always)]
    fn all(self) -> bool {
        self.bitmask() == (1u32 << Self::LANES) - 1
    }

    /// `self & !other`.
    #[inline(always)]
    fn and_not(self, other: Self) -> Self {
        self & !other
    }
}

/// Smallest-of-two with the semantics of [`Vector::min`].
#[inline(always)]
pub fn min_f32(a: f32, b: f32) -> f32 {
    if a < b {
        a
    } else {
        b
    }
}

/// Largest-of-two with the semantics of [`Vector::max`].
#[inline(always)]
pub fn max_f32(a: f32, b: f32) -> f32 {
    if a > b {
        a
    } else {
        b
    }
}

/// An 8-lane vector made of two 4-lane halves: lanes 0..4 in `.0`, lanes 4..8 in `.1`.
#[derive(Clone, Copy, Debug)]
pub struct Pair<V>(pub V, pub V);

impl<V: Vector<Array = [f32; 4]>> Add for Pair<V> {
    type Output = Self;
    #[inline(always)]
    fn add(self, o: Self) -> Self {
        Pair(self.0 + o.0, self.1 + o.1)
    }
}

impl<V: Vector<Array = [f32; 4]>> Sub for Pair<V> {
    type Output = Self;
    #[inline(always)]
    fn sub(self, o: Self) -> Self {
        Pair(self.0 - o.0, self.1 - o.1)
    }
}

impl<V: Vector<Array = [f32; 4]>> Mul for Pair<V> {
    type Output = Self;
    #[inline(always)]
    fn mul(self, o: Self) -> Self {
        Pair(self.0 * o.0, self.1 * o.1)
    }
}

impl<V: Vector<Array = [f32; 4]>> Div for Pair<V> {
    type Output = Self;
    #[inline(always)]
    fn div(self, o: Self) -> Self {
        Pair(self.0 / o.0, self.1 / o.1)
    }
}

impl<M: Mask> BitAnd for Pair<M> {
    type Output = Self;
    #[inline(always)]
    fn bitand(self, o: Self) -> Self {
        Pair(self.0 & o.0, self.1 & o.1)
    }
}

impl<M: Mask> BitOr for Pair<M> {
    type Output = Self;
    #[inline(always)]
    fn bitor(self, o: Self) -> Self {
        Pair(self.0 | o.0, self.1 | o.1)
    }
}

impl<M: Mask> Not for Pair<M> {
    type Output = Self;
    #[inline(always)]
    fn not(self) -> Self {
        Pair(!self.0, !self.1)
    }
}

impl<M: Mask> Mask for Pair<M> {
    const LANES: usize = 2 * M::LANES;

    #[inline(always)]
    fn bitmask(self) -> u32 {
        self.0.bitmask() | (self.1.bitmask() << M::LANES)
    }
}

impl<V: Vector<Array = [f32; 4]>> Vector for Pair<V> {
    const LANES: usize = 8;
    type Array = [f32; 8];
    type Mask = Pair<V::Mask>;

    #[inline(always)]
    fn splat(v: f32) -> Self {
        Pair(V::splat(v), V::splat(v))
    }

    #[inline(always)]
    fn load(src: &[f32; 8]) -> Self {
        let (halves, _) = src.as_chunks::<4>();
        Pair(V::load(&halves[0]), V::load(&halves[1]))
    }

    #[inline(always)]
    fn store(self, dst: &mut [f32; 8]) {
        let (halves, _) = dst.as_chunks_mut::<4>();
        self.0.store(&mut halves[0]);
        self.1.store(&mut halves[1]);
    }

    #[inline(always)]
    fn min(self, o: Self) -> Self {
        Pair(self.0.min(o.0), self.1.min(o.1))
    }

    #[inline(always)]
    fn max(self, o: Self) -> Self {
        Pair(self.0.max(o.0), self.1.max(o.1))
    }

    #[inline(always)]
    fn lt(self, o: Self) -> Self::Mask {
        Pair(self.0.lt(o.0), self.1.lt(o.1))
    }

    #[inline(always)]
    fn le(self, o: Self) -> Self::Mask {
        Pair(self.0.le(o.0), self.1.le(o.1))
    }

    #[inline(always)]
    fn gt(self, o: Self) -> Self::Mask {
        Pair(self.0.gt(o.0), self.1.gt(o.1))
    }

    #[inline(always)]
    fn ge(self, o: Self) -> Self::Mask {
        Pair(self.0.ge(o.0), self.1.ge(o.1))
    }

    #[inline(always)]
    fn eq(self, o: Self) -> Self::Mask {
        Pair(self.0.eq(o.0), self.1.eq(o.1))
    }

    #[inline(always)]
    fn select(mask: Self::Mask, t: Self, f: Self) -> Self {
        Pair(V::select(mask.0, t.0, f.0), V::select(mask.1, t.1, f.1))
    }

    #[inline(always)]
    fn reduce_min(self) -> f32 {
        // First level of the tree: lane i against lane i + 4.
        self.0.min(self.1).reduce_min()
    }

    #[inline(always)]
    fn reduce_max(self) -> f32 {
        self.0.max(self.1).reduce_max()
    }
}

/// A set of vector types: the kernels are generic over it.
pub trait Backend {
    /// Four lanes (triangle packets, BVH4 nodes).
    type V4: Vector<Array = [f32; 4]>;
    /// Eight lanes (BVH8 nodes).
    type V8: Vector<Array = [f32; 8]>;
}

/// The scalar reference backend: [`scalar::F32x4`] and [`scalar::F32x8`].
#[derive(Clone, Copy, Debug)]
pub struct ScalarBackend;

impl Backend for ScalarBackend {
    type V4 = scalar::F32x4;
    type V8 = scalar::F32x8;
}

/// Code that runs on a [`Backend`] chosen at run time. See [`Isa::dispatch`].
///
/// Implementations should mark `run` (and everything it calls) `#[inline(always)]`, so that the
/// whole kernel is compiled inside the target-feature function of the dispatched path.
pub trait Kernel {
    /// What the kernel returns.
    type Output;
    /// Runs the kernel with the vector types of `B`.
    fn run<B: Backend>(self) -> Self::Output;
}

/// The SIMD paths of the engine.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Isa {
    /// The scalar reference implementation, available everywhere.
    Scalar,
    /// SSE2 on `x86_64` (always present there).
    Sse2,
    /// AVX2 on `x86_64`, when the CPU has it.
    Avx2,
    /// NEON (Advanced SIMD) on `aarch64`.
    Neon,
    /// WebAssembly `simd128`, when the module is built with `-C target-feature=+simd128`.
    Simd128,
}

/// True when the CPU running this code supports AVX2.
#[cfg(target_arch = "x86_64")]
#[inline(always)]
fn avx2_detected() -> bool {
    std::arch::is_x86_feature_detected!("avx2")
}

impl Isa {
    /// Every path, in order of preference from worst to best.
    pub const ALL: [Isa; 5] = [Isa::Scalar, Isa::Sse2, Isa::Neon, Isa::Simd128, Isa::Avx2];

    /// The best path for the running machine.
    pub fn detect() -> Isa {
        Isa::ALL
            .iter()
            .rev()
            .copied()
            .find(|isa| isa.is_available())
            .unwrap_or(Isa::Scalar)
    }

    /// Every path that really runs on this machine (always includes [`Isa::Scalar`]).
    pub fn available() -> Vec<Isa> {
        Isa::ALL.into_iter().filter(|i| i.is_available()).collect()
    }

    /// True when this path runs here; otherwise [`Isa::dispatch`] falls back to the scalar one.
    pub fn is_available(self) -> bool {
        match self {
            Isa::Scalar => true,
            #[cfg(target_arch = "x86_64")]
            Isa::Sse2 => true,
            #[cfg(target_arch = "x86_64")]
            Isa::Avx2 => avx2_detected(),
            #[cfg(all(target_arch = "aarch64", target_feature = "neon"))]
            Isa::Neon => true,
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            Isa::Simd128 => true,
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }

    /// Native `f32` lanes of the path: 8 for AVX2, 4 for the 128-bit paths, 1 for scalar.
    pub fn lanes(self) -> usize {
        match self {
            Isa::Scalar => 1,
            Isa::Avx2 => 8,
            Isa::Sse2 | Isa::Neon | Isa::Simd128 => 4,
        }
    }

    /// Short lower-case name (`"avx2"`, `"sse2"`, ...).
    pub fn name(self) -> &'static str {
        match self {
            Isa::Scalar => "scalar",
            Isa::Sse2 => "sse2",
            Isa::Avx2 => "avx2",
            Isa::Neon => "neon",
            Isa::Simd128 => "simd128",
        }
    }

    /// Runs `kernel` with the backend of this path, or with [`ScalarBackend`] when the path is
    /// not available on this machine (so any `Isa` value is safe to pass).
    #[inline(always)]
    pub fn dispatch<K: Kernel>(self, kernel: K) -> K::Output {
        match self {
            #[cfg(target_arch = "x86_64")]
            Isa::Avx2 if avx2_detected() => {
                // SAFETY: `run_avx2` only requires AVX2, which the guard just confirmed.
                unsafe { x86::run_avx2(kernel) }
            }
            #[cfg(target_arch = "x86_64")]
            Isa::Sse2 => kernel.run::<x86::Sse2>(),
            #[cfg(all(target_arch = "aarch64", target_feature = "neon"))]
            Isa::Neon => kernel.run::<neon::Neon>(),
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            Isa::Simd128 => kernel.run::<wasm::Simd128>(),
            _ => kernel.run::<ScalarBackend>(),
        }
    }
}

/// The best 4-lane vector known at compile time.
#[cfg(target_arch = "x86_64")]
pub type F32x4 = x86::F32x4;
/// The best 8-lane vector known at compile time.
#[cfg(target_arch = "x86_64")]
pub type F32x8 = Pair<x86::F32x4>;

/// The best 4-lane vector known at compile time.
#[cfg(all(target_arch = "aarch64", target_feature = "neon"))]
pub type F32x4 = neon::F32x4;
/// The best 8-lane vector known at compile time.
#[cfg(all(target_arch = "aarch64", target_feature = "neon"))]
pub type F32x8 = Pair<neon::F32x4>;

/// The best 4-lane vector known at compile time.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
pub type F32x4 = wasm::F32x4;
/// The best 8-lane vector known at compile time.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
pub type F32x8 = Pair<wasm::F32x4>;

/// The best 4-lane vector known at compile time (scalar on this target).
#[cfg(not(any(
    target_arch = "x86_64",
    all(target_arch = "aarch64", target_feature = "neon"),
    all(target_arch = "wasm32", target_feature = "simd128")
)))]
pub type F32x4 = scalar::F32x4;
/// The best 8-lane vector known at compile time (scalar on this target).
#[cfg(not(any(
    target_arch = "x86_64",
    all(target_arch = "aarch64", target_feature = "neon"),
    all(target_arch = "wasm32", target_feature = "simd128")
)))]
pub type F32x8 = scalar::F32x8;

/// Mask of [`F32x4`].
pub type M32x4 = <F32x4 as Vector>::Mask;
/// Mask of [`F32x8`].
pub type M32x8 = <F32x8 as Vector>::Mask;

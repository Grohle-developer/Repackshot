//! Every operation of every available path against the scalar reference, bit for bit.

use super::*;
use crate::rng::Pcg32;

/// Results of every operation on one set of inputs, flattened.
#[derive(Debug, Default)]
struct Outcome {
    floats: Vec<f32>,
    masks: Vec<u32>,
    flags: Vec<bool>,
}

fn array_of<V: Vector>(src: &[f32]) -> V::Array {
    let mut out = V::Array::default();
    out.as_mut().copy_from_slice(&src[..V::LANES]);
    out
}

/// Applies every operation of `V` to `a`, `b`, `c`, appending the results to `out`.
#[inline(always)]
fn exercise<V: Vector>(a: &[f32], b: &[f32], c: &[f32], out: &mut Outcome) {
    let (x, y, z) = (
        V::load(&array_of::<V>(a)),
        V::load(&array_of::<V>(b)),
        V::load(&array_of::<V>(c)),
    );
    let lt = x.lt(y);
    let le = x.le(y);
    let gt = x.gt(y);
    let ge = x.ge(y);
    let eq = x.eq(y);
    for v in [
        x,
        x + y,
        x - y,
        x * y,
        x / y,
        x.min(y),
        x.max(y),
        y.min(x),
        y.max(x),
        x.mul_add(y, z),
        V::select(lt, x, z),
        V::select(eq | gt, y, z),
        V::select(!le, z, x),
        V::splat(a[0]),
    ] {
        out.floats.extend_from_slice(v.to_array().as_ref());
        let mut stored = V::Array::default();
        v.store(&mut stored);
        out.floats.extend_from_slice(stored.as_ref());
    }
    for v in [x, y, z, x * y] {
        out.floats.push(v.reduce_min());
        out.floats.push(v.reduce_max());
    }
    for m in [
        lt,
        le,
        gt,
        ge,
        eq,
        lt & ge,
        lt | eq,
        !lt,
        le.and_not(eq),
        z.lt(x) & y.ge(z),
    ] {
        out.masks.push(m.bitmask());
        out.flags.push(m.any());
        out.flags.push(m.all());
    }
}

/// The inputs: lanes of three vectors, `count` vectors of eight lanes each.
struct Inputs {
    a: Vec<f32>,
    b: Vec<f32>,
    c: Vec<f32>,
}

const SPECIAL: [f32; 14] = [
    0.0,
    -0.0,
    1.0,
    -1.0,
    0.5,
    f32::INFINITY,
    f32::NEG_INFINITY,
    f32::NAN,
    f32::MIN_POSITIVE,
    1.0e-40, // subnormal
    -1.0e-40,
    f32::MAX,
    -f32::MAX,
    f32::EPSILON,
];

fn random_value(rng: &mut Pcg32) -> f32 {
    match rng.next_u32() % 4 {
        0 => SPECIAL[(rng.next_u32() % SPECIAL.len() as u32) as usize],
        1 => f32::from_bits(rng.next_u32()), // any bit pattern, NaNs included
        _ => (rng.next_f32() - 0.5) * 200.0,
    }
}

fn inputs(count: usize, seed: u64) -> Inputs {
    let mut rng = Pcg32::seeded(seed, 11);
    let make = |rng: &mut Pcg32| (0..count * 8).map(|_| random_value(rng)).collect();
    let a: Vec<f32> = make(&mut rng);
    let mut b: Vec<f32> = make(&mut rng);
    let c = make(&mut rng);
    // Ties exercise the operand order of min/max and the comparisons.
    for i in 0..b.len() {
        if rng.next_u32().is_multiple_of(5) {
            b[i] = a[i];
        }
    }
    Inputs { a, b, c }
}

struct OpsKernel<'a>(&'a Inputs);

impl Kernel for OpsKernel<'_> {
    type Output = Outcome;

    #[inline(always)]
    fn run<B: Backend>(self) -> Outcome {
        let mut out = Outcome::default();
        let inputs = self.0;
        for i in (0..inputs.a.len()).step_by(8) {
            let (a, b, c) = (
                &inputs.a[i..i + 8],
                &inputs.b[i..i + 8],
                &inputs.c[i..i + 8],
            );
            exercise::<B::V4>(&a[..4], &b[..4], &c[..4], &mut out);
            exercise::<B::V4>(&a[4..], &b[4..], &c[4..], &mut out);
            exercise::<B::V8>(a, b, c, &mut out);
        }
        out
    }
}

fn same_bits(x: f32, y: f32) -> bool {
    // NaN payloads are not specified by IEEE 754 (and are non-deterministic in wasm): only
    // NaN-ness is compared for them. Every other value, signed zeros included, must match bits.
    x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan())
}

#[test]
fn every_available_path_matches_the_scalar_reference_bit_for_bit() {
    let inputs = inputs(4096, 7);
    let reference = Isa::Scalar.dispatch(OpsKernel(&inputs));
    assert!(reference.floats.len() > 100_000);
    for isa in Isa::available() {
        let got = isa.dispatch(OpsKernel(&inputs));
        assert_eq!(got.floats.len(), reference.floats.len());
        for (i, (&g, &r)) in got.floats.iter().zip(&reference.floats).enumerate() {
            assert!(
                same_bits(g, r),
                "{}: float result {i} is {g:?} ({:#010x}), scalar gives {r:?} ({:#010x})",
                isa.name(),
                g.to_bits(),
                r.to_bits()
            );
        }
        assert_eq!(got.masks, reference.masks, "{}: masks", isa.name());
        assert_eq!(got.flags, reference.flags, "{}: any/all", isa.name());
    }
}

#[test]
fn the_compile_time_types_match_the_scalar_reference() {
    let inputs = inputs(256, 3);
    let mut native = Outcome::default();
    let mut reference = Outcome::default();
    for i in (0..inputs.a.len()).step_by(8) {
        let (a, b, c) = (
            &inputs.a[i..i + 8],
            &inputs.b[i..i + 8],
            &inputs.c[i..i + 8],
        );
        exercise::<F32x4>(a, b, c, &mut native);
        exercise::<F32x8>(a, b, c, &mut native);
        exercise::<scalar::F32x4>(a, b, c, &mut reference);
        exercise::<scalar::F32x8>(a, b, c, &mut reference);
    }
    assert!(native
        .floats
        .iter()
        .zip(&reference.floats)
        .all(|(&g, &r)| same_bits(g, r)));
    assert_eq!(native.masks, reference.masks);
    assert_eq!(native.flags, reference.flags);
}

#[test]
fn min_and_max_follow_the_documented_operand_order() {
    use scalar::F32x4 as S;
    let a = S([f32::NAN, 1.0, -0.0, 0.0]);
    let b = S([2.0, f32::NAN, 0.0, -0.0]);
    // A NaN in the first operand yields the second operand, and the other way round.
    let min = a.min(b).0;
    assert_eq!(min[0], 2.0);
    assert!(min[1].is_nan());
    // Equal values (signed zeros) give the second operand.
    assert!(min[2].is_sign_positive() && min[3].is_sign_negative());
    let max = a.max(b).0;
    assert_eq!(max[0], 2.0);
    assert!(max[1].is_nan());
    assert!(max[2].is_sign_positive() && max[3].is_sign_negative());
    // The reduction tree: min(min(a0, a2), min(a1, a3)).
    assert_eq!(S([3.0, 1.0, 2.0, 0.5]).reduce_min(), 0.5);
    assert_eq!(S([3.0, 1.0, 2.0, 0.5]).reduce_max(), 3.0);
    assert!(S([-0.0, 0.0, 0.0, -0.0]).reduce_min().is_sign_negative());
}

#[test]
fn isa_detection_and_fallback() {
    let available = Isa::available();
    assert!(available.contains(&Isa::Scalar));
    assert!(available.contains(&Isa::detect()));
    assert!(Isa::detect().is_available());
    #[cfg(target_arch = "x86_64")]
    assert!(available.contains(&Isa::Sse2));
    // A path that does not exist here still runs, on the scalar backend.
    struct Lanes;
    impl Kernel for Lanes {
        type Output = usize;
        fn run<B: Backend>(self) -> usize {
            <B::V8 as Vector>::LANES + <B::V4 as Vector>::LANES
        }
    }
    for isa in Isa::ALL {
        assert_eq!(isa.dispatch(Lanes), 12, "{}", isa.name());
        assert!(!isa.name().is_empty());
        assert!(isa.lanes() >= 1);
    }
    let names: Vec<&str> = Isa::ALL.iter().map(|i| i.name()).collect();
    assert_eq!(names, ["scalar", "sse2", "neon", "simd128", "avx2"]);
}

#[test]
fn masks_report_any_and_all() {
    use scalar::{F32x8 as S8, M32x8};
    let m = S8([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]).lt(S8::splat(3.5));
    assert_eq!(m.bitmask(), 0b0000_0111);
    assert!(m.any() && !m.all());
    assert!((!M32x8([false; 8])).all());
    assert!(!M32x8([false; 8]).any());
}

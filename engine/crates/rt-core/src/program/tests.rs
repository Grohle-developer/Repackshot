//! Tests of the material programs (M3b): the cross test against the reference interpreter of the
//! page (the shared fixture `tests/fixtures/material-programs.json`, which
//! `tests/material-program-cross.test.ts` writes and pins: the ten example graphs at 1000 points,
//! every instruction in every mode on operands of the shading point, every scalar function on the
//! special numbers), the points of the contract, the noise's pins, and what the reader accepts and
//! refuses.

use super::interp::{Context, Host, NoHost, Outputs, Runner};
use super::noise::{fbm, hash3, perlin3, simplex3};
use super::*;
use crate::math::Vec3;
use crate::pattern::knots::{Knot, Knots};
use crate::pattern::Placement;
use crate::texture::image::{TextureImage, COLOR_LINEAR, COLOR_SRGB};
use std::sync::Arc;

const FIXTURE: &str = include_str!("../../../../../tests/fixtures/material-programs.json");

// ---------------------------------------------------------------------------- the fixture

/// Standard base64 (with padding) to bytes.
fn unbase64(text: &str) -> Vec<u8> {
    let value = |c: u8| -> u32 {
        match c {
            b'A'..=b'Z' => u32::from(c - b'A'),
            b'a'..=b'z' => u32::from(c - b'a') + 26,
            b'0'..=b'9' => u32::from(c - b'0') + 52,
            b'+' => 62,
            b'/' => 63,
            _ => panic!("not base64: {c}"),
        }
    };
    let bytes: Vec<u8> = text.bytes().filter(|&c| c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= value(c) << (18 - 6 * i);
        }
        out.push((acc >> 16) as u8);
        if chunk.len() > 2 {
            out.push((acc >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(acc as u8);
        }
    }
    out
}

/// The text of the string field `key` in `line` (`"key": "value"`).
fn string_field<'a>(line: &'a str, key: &str) -> &'a str {
    let at = line
        .find(&format!("\"{key}\": \""))
        .unwrap_or_else(|| panic!("no {key} in {line}"));
    let rest = &line[at + key.len() + 5..];
    &rest[..rest.find('"').expect("closing quote")]
}

/// The number field `key` in `line` (`"key": 12`).
fn number_field(line: &str, key: &str) -> u64 {
    let at = line
        .find(&format!("\"{key}\": "))
        .unwrap_or_else(|| panic!("no {key} in {line}"));
    let rest = &line[at + key.len() + 4..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    rest[..end].parse().expect("a number")
}

struct Case {
    name: String,
    points: usize,
    seed: u32,
    hash: u32,
    program: Program,
    /// M3c: where its pattern instructions' patterns lie (`None`: the point's own space).
    placement: Option<Placement>,
}

/// M3c: the fixture's `placement` (f32 little-endian, base64): origin, axes, mm, darkness, the
/// count of knots, then per knot its origin, axis, flow, across, middle, radius and crack (−1:
/// none).
fn placement_of(text: &str) -> Placement {
    let bytes = unbase64(text);
    let xs: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let v = |i: usize| Vec3::new(xs[i], xs[i + 1], xs[i + 2]);
    let count = xs[14] as usize;
    let list = (0..count)
        .map(|k| {
            let at = 15 + k * 15;
            Knot {
                origin: v(at),
                axis: v(at + 3),
                flow: v(at + 6),
                across: v(at + 9),
                middle: xs[at + 12],
                radius: xs[at + 13],
                crack: (xs[at + 14] >= 0.0).then_some(xs[at + 14]),
            }
        })
        .collect();
    assert_eq!(xs.len(), 15 + count * 15);
    Placement {
        origin: v(0),
        axes: [v(3), v(6), v(9)],
        mm: xs[12],
        knots: Knots {
            list,
            darkness: xs[13],
        },
    }
}

/// The cross test's host: no geometry, no footprint, a case's placement for its patterns.
struct FixtureHost<'a>(Option<&'a Placement>);

impl Host for FixtureHost<'_> {
    fn footprint(&self) -> Option<&interp::Footprint> {
        None
    }
    fn edge(&mut self, _radius: f32) -> f32 {
        0.0
    }
    fn cavity(&mut self, _radius: f32) -> f32 {
        0.0
    }
    fn placement(&mut self, _k: u32, _kind: u32) -> Option<&Placement> {
        self.0
    }
}

fn cases() -> Vec<Case> {
    FIXTURE
        .lines()
        .filter(|l| l.trim_start().starts_with("{\"name\""))
        .map(|line| {
            let bytes =
                crate::inflate::zlib_decompress(&unbase64(string_field(line, "program")), 1 << 24)
                    .expect("a zlib stream");
            let name = string_field(line, "name").to_string();
            let program = Program::decode(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
            Case {
                points: number_field(line, "points") as usize,
                seed: number_field(line, "seed") as u32,
                hash: u32::from_str_radix(string_field(line, "hash"), 16).expect("hex"),
                program,
                name,
                placement: line
                    .contains("\"placement\"")
                    .then(|| placement_of(string_field(line, "placement"))),
            }
        })
        .collect()
}

/// The label picture of the example with a label (RGBA, rows from the top).
fn label() -> (u32, u32, Vec<u8>) {
    let line = FIXTURE
        .lines()
        .find(|l| l.contains("\"label\""))
        .expect("label");
    let w = number_field(line, "width") as u32;
    let h = number_field(line, "height") as u32;
    let px = crate::inflate::zlib_decompress(&unbase64(string_field(line, "rgba")), 1 << 24)
        .expect("zlib");
    assert_eq!(px.len(), (w * h * 4) as usize);
    (w, h, px)
}

/// The test image of the image cases.
fn test_image() -> (u32, u32, Vec<u8>) {
    let line = FIXTURE
        .lines()
        .find(|l| l.contains("\"testImage\""))
        .expect("testImage");
    let w = number_field(line, "width") as u32;
    let h = number_field(line, "height") as u32;
    let list = &line[line.find('[').expect("[") + 1..line.find(']').expect("]")];
    let px: Vec<u8> = list
        .split(',')
        .map(|v| v.trim().parse().expect("a byte"))
        .collect();
    (w, h, px)
}

/// The images of a case's table: index 0 the label, 1 the test image, each in the colour space
/// of its entry.
fn images_of(p: &Program) -> Vec<Option<Arc<TextureImage>>> {
    p.images
        .iter()
        .map(|e| {
            let (w, h, px) = match e.image? {
                0 => label(),
                1 => test_image(),
                other => panic!("no image {other}"),
            };
            let space = if e.srgb { COLOR_SRGB } else { COLOR_LINEAR };
            Some(Arc::new(
                TextureImage::new(w, h, 4, space, px).expect("image"),
            ))
        })
        .collect()
}

// ---------------------------------------------------------------------------- the points

/// `contractPoints` of `src/core/material-interp.ts`: a xorshift32 generator; per point P, N, the
/// two UV sets, I, T = onb(N), B = N × T and the UV changes, each made in f64 and rounded once.
fn contract_points(count: usize, seed: u32) -> Vec<Context> {
    let mut x = if seed == 0 { 1 } else { seed };
    let mut r = move || -> f64 {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        f64::from(x >> 8) / 16_777_216.0
    };
    let unit = |a: f32, b: f32, c: f32, fallback: [f32; 3]| -> [f32; 3] {
        let l = ((a * a + b * b) + c * c).sqrt();
        if l > 0.0 {
            [a / l, b / l, c / l]
        } else {
            fallback
        }
    };
    (0..count)
        .map(|_| {
            let p = [0, 1, 2].map(|_| (200.0 * r() - 100.0) as f32);
            let nn = [0, 1, 2].map(|_| (2.0 * r() - 1.0) as f32);
            let n = unit(nn[0], nn[1], nn[2], [0.0, 0.0, 1.0]);
            let uv0 = [(2.0 * r() - 0.5) as f32, (2.0 * r() - 0.5) as f32, 0.0];
            let uv1 = [(2.0 * r() - 0.5) as f32, (2.0 * r() - 0.5) as f32, 0.0];
            let ii = [0, 1, 2].map(|_| (2.0 * r() - 1.0) as f32);
            let i = unit(ii[0], ii[1], ii[2], n);
            let t = interp::onb_tangent(n);
            let b = [
                n[1] * t[2] - n[2] * t[1],
                n[2] * t[0] - n[0] * t[2],
                n[0] * t[1] - n[1] * t[0],
            ];
            let duv_t = [(0.02 * r()) as f32, (0.02 * r()) as f32, 0.0];
            let duv_b = [(0.02 * r()) as f32, (0.02 * r()) as f32, 0.0];
            Context {
                p,
                n,
                uv0,
                uv1,
                i,
                t,
                b,
                duv_t,
                duv_b,
            }
        })
        .collect()
}

/// FNV-1a over the bytes of 32-bit words.
fn fnv(h: &mut u32, word: u32) {
    for k in 0..4 {
        *h ^= (word >> (k * 8)) & 0xff;
        *h = h.wrapping_mul(0x0100_0193);
    }
}

/// `outputsHash` of the reference: every output (one or three components) at every point, point
/// after point, every NaN as the one quiet NaN `0x7FC00000` (`crossHash`, tests/program-hash.ts):
/// the sign and payload of a NaN result are the machine's (under Node's WASI one case gave a NaN
/// of the other sign run among all the tests, and the reference's run alone), and nothing the engine does with
/// a value reads them.
fn outputs_hash(runner: &Runner, points: &[Context]) -> u32 {
    outputs_hash_with(runner, points, None)
}

/// [`outputs_hash`] with the patterns placed by `placement` (M3c).
fn outputs_hash_with(runner: &Runner, points: &[Context], placement: Option<&Placement>) -> u32 {
    let mut h = 0x811c_9dc5u32;
    let outputs = &runner.program().outputs;
    let mut values = vec![[0.0f32; 3]; outputs.len()];
    let mut host = FixtureHost(placement);
    for pt in points {
        runner.run_into(pt, &mut host, &mut values);
        for (o, v) in outputs.iter().zip(&values) {
            let n = if o.is_vec() { 3 } else { 1 };
            for c in &v[..n] {
                fnv(&mut h, if c.is_nan() { 0x7fc0_0000 } else { c.to_bits() });
            }
        }
    }
    h
}

#[test]
fn the_points_are_the_contracts() {
    let line = FIXTURE
        .lines()
        .find(|l| l.contains("pointsHash1000"))
        .expect("pointsHash1000");
    let want = u32::from_str_radix(string_field(line, "pointsHash1000"), 16).expect("hex");
    let mut h = 0x811c_9dc5u32;
    for pt in contract_points(1000, 0x2545_f491) {
        for v in [
            pt.p, pt.n, pt.uv0, pt.uv1, pt.i, pt.t, pt.b, pt.duv_t, pt.duv_b,
        ] {
            for c in v {
                fnv(&mut h, c.to_bits());
            }
        }
    }
    assert_eq!(h, want);
    // The first point of the reference's own pin (tests/material-program.test.ts).
    let first = contract_points(1, 0x2545_f491)[0];
    assert_eq!(first.p, [75.893_28, 9.065_104, -21.186_22]);
}

#[test]
fn the_engine_gives_the_reference_bits_in_every_case() {
    // Tolerance 0: both sides make the same f32 operations in the same order, with correctly
    // rounded + − × ÷ √ and the same elementary functions (fmath, emulated in core/f32math.ts),
    // so any difference is a deviation from the contract, not rounding.
    let cases = cases();
    assert!(cases.len() > 150, "{} cases", cases.len());
    let mut wrong = Vec::new();
    for c in &cases {
        let runner = Runner::new(c.program.clone(), images_of(&c.program));
        let got = outputs_hash_with(
            &runner,
            &contract_points(c.points, c.seed),
            c.placement.as_ref(),
        );
        if got != c.hash {
            wrong.push(format!("{}: {got:08x} (reference {:08x})", c.name, c.hash));
        }
    }
    assert!(wrong.is_empty(), "differ from the reference: {wrong:#?}");
}

#[test]
fn the_ten_examples_are_the_m3a_pins() {
    let pins = [
        ("PLASTIC_LABEL", 0xca47_a410u32),
        ("BRUSHED_SCRATCHED", 0xd7ac_667e),
        ("MARBLE", 0x9068_993f),
        ("LEATHER", 0x4ffd_820c),
        ("WOOD_TWO_NOISES", 0x6600_a83f),
        ("GLASS_DIRT", 0xec12_61b4),
        ("CHECKS", 0x27d9_baac),
        ("METALLIC_FLAKES", 0x3795_f601),
        ("GLAZED_CERAMIC", 0xe17b_0ee2),
        ("STRIPES", 0x9dd8_d317),
    ];
    let cases = cases();
    let points = contract_points(1000, 0x2545_f491);
    for (key, pin) in pins {
        let c = cases.iter().find(|c| c.name == key).expect(key);
        assert!(c.program.is_material(), "{key}");
        let runner = Runner::new(c.program.clone(), images_of(&c.program));
        assert_eq!(outputs_hash(&runner, &points), pin, "{key}");
    }
}

#[test]
fn the_noise_has_the_contracts_pins() {
    // tests/material-program.test.ts NOISE_PINS (the reference's values in f64 of their f32).
    let got = [
        perlin3(0.3, 1.7, -2.2, 0),
        perlin3(10.5, -3.25, 0.125, 9),
        simplex3(0.3, 1.7, -2.2, 0),
        simplex3(10.5, -3.25, 0.125, 9),
        fbm(false, 1.1, 2.2, 3.3, 5.0, 2.0, 0.5, 4),
    ];
    let want = [
        -0.394_427_627_325_058f64,
        -0.081_581_197_679_042_82,
        -0.300_960_540_771_484_4,
        0.489_969_730_377_197_27,
        0.480_417_788_028_717_04,
    ];
    for (g, w) in got.iter().zip(want) {
        assert_eq!(f64::from(*g), w);
    }
    assert_eq!(perlin3(3.0, -2.0, 7.0, 0), 0.0);
    assert_eq!(hash3(1, 2, 3, 0), hash3(1, 2, 3, 0));
    assert_ne!(hash3(1, 2, 3, 0), hash3(1, 2, 3, 1));
    assert_eq!(perlin3(2.0e9, 0.0, 0.0, 0), 0.0);
    assert_eq!(simplex3(f32::NAN, 0.0, 0.0, 0), 0.0);
}

// ---------------------------------------------------------------------------- the reader

/// A small valid material program: the output node's constants, the base colour from a
/// constant through FMOV-free arithmetic.
fn small() -> Program {
    let mut consts = vec![0.5f32, 0.25, 0.75];
    // FC outputs: metallic .. bevel.
    let scalar_at = consts.len() as u32;
    consts.push(0.0);
    Program {
        code: vec![
            Instr {
                op: op::VCONST,
                d: 9,
                a: NONE,
                b: NONE,
                c: NONE,
                k: 0,
            },
            Instr {
                op: op::VLUM,
                d: 0,
                a: 9,
                b: NONE,
                c: NONE,
                k: NONE,
            },
        ],
        consts,
        images: vec![],
        nf: 1,
        nv: 10,
        outputs: (0..OUTPUTS)
            .map(|i| match i {
                OUT_BASE_COLOR => ValueRef::V(9),
                OUT_EMISSION => ValueRef::VConst(0),
                OUT_NORMAL => ValueRef::V(1),
                OUT_ROUGHNESS => ValueRef::F(0),
                _ => ValueRef::FConst(scalar_at),
            })
            .collect(),
        absorption_mm: 0.0,
        flags: 0,
    }
}

#[test]
fn programs_read_back_and_bad_ones_are_refused() {
    let p = small();
    let bytes = p.encode();
    assert_eq!(Program::decode(&bytes), Ok(p.clone()));
    assert!(p.is_material());
    // Another version is a newer file's.
    let mut newer = bytes.clone();
    newer[4] = 2;
    assert_eq!(Program::decode(&newer), Err(ProgramError::Version(2)));
    let refuse = |change: &dyn Fn(&mut Program)| {
        let mut q = small();
        change(&mut q);
        assert!(
            matches!(Program::decode(&q.encode()), Err(ProgramError::Invalid(_))),
            "{q:?}"
        );
    };
    refuse(&|q| q.code[0].op = 999);
    refuse(&|q| q.code[1].a = 10); // past nv
    refuse(&|q| q.code[1].a = 12); // past nv
    refuse(&|q| q.code[0].k = 2); // VCONST reads past the constants
    refuse(&|q| q.code[1].d = 1); // FVLUM's destination past nf
    refuse(&|q| {
        // A register read before anything writes it.
        q.code.swap(0, 1);
    });
    refuse(&|q| {
        // A destination that is an operand of its own instruction.
        q.code.push(Instr {
            op: op::VADD,
            d: 9,
            a: 9,
            b: 1,
            c: NONE,
            k: NONE,
        });
    });
    refuse(&|q| q.outputs[OUT_ROUGHNESS] = ValueRef::F(3));
    refuse(&|q| q.outputs[OUT_EMISSION] = ValueRef::VConst(3));
    refuse(&|q| q.nv = 3);
    refuse(&|q| q.absorption_mm = -1.0);
    refuse(&|q| {
        // A ramp whose stops are not there.
        q.consts.extend([3.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
        q.code.push(Instr {
            op: op::RAMP,
            d: 10,
            a: 0,
            b: NONE,
            c: NONE,
            k: 4,
        });
        q.nv = 11;
    });
    // Trailing or missing bytes.
    let mut long = bytes.clone();
    long.extend([0, 0, 0, 0]);
    assert!(Program::decode(&long).is_err());
    assert!(Program::decode(&bytes[..bytes.len() - 4]).is_err());
    // Not a material's: an output of the wrong type.
    let mut q = small();
    q.outputs[OUT_BASE_COLOR] = ValueRef::F(0);
    assert!(!Program::decode(&q.encode()).expect("valid").is_material());
}

#[test]
fn a_run_allocates_nothing_and_does_not_depend_on_the_run_before() {
    // The same point after another gives the same outputs (registers are written before read).
    let cases = cases();
    let c = cases.iter().find(|c| c.name == "MARBLE").expect("marble");
    let runner = Runner::new(c.program.clone(), images_of(&c.program));
    let pts = contract_points(3, 9);
    let mut a = Outputs::default();
    let mut b = Outputs::default();
    runner.run(&pts[0], &mut NoHost, &mut a);
    runner.run(&pts[1], &mut NoHost, &mut b);
    runner.run(&pts[0], &mut NoHost, &mut b);
    assert_eq!(a, b);
}

#[test]
fn the_m3b_example_programs_have_pinned_values() {
    // The programs of the engine's own example (written by hand, crate::example::m3b_programs) at
    // 200 points of the contract with the example's images: tests/programs-engine.test.ts reads
    // them from tests/fixtures/m3b.rsb and runs the page's reference interpreter on them, which
    // must give these hashes too (the cross test the other way round).
    let images = crate::example::m2b_images();
    let points = contract_points(200, 0x2545_f491);
    let got: Vec<u32> = crate::example::m3b_programs()
        .into_iter()
        .map(|p| {
            let imgs = p
                .images
                .iter()
                .map(|e| e.image.map(|k| Arc::new(images[k as usize].clone())))
                .collect();
            outputs_hash(&Runner::new(p, imgs), &points)
        })
        .collect();
    eprintln!("M3b example programs: {got:08x?}");
    assert_eq!(got, PINNED_M3B_PROGRAM_VALUES);
}

/// The FNV-1a of every output of each program of the M3b example at 200 points of the contract.
/// C1 moved the fifth (the card's flakes into `NMAP`, `0x587e_907c` before): its blues below 0.5
/// are mirrored out of the surface.
const PINNED_M3B_PROGRAM_VALUES: [u32; 7] = [
    0x6a76_96a8,
    0x870f_56ba,
    0xb6ca_5408,
    0xcf11_f98a,
    0x6d55_bcef,
    0x064b_830e,
    0x214b_bc47,
];

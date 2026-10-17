//! Material programs (M3b): the engine runs the linear programs the page compiles a material
//! graph to (M3a, `src/core/material-program.ts`), at every hit of a part whose material has one.
//!
//! The contract is ARCHITECTURE §5.2 quater, written instruction by instruction: two register
//! files, `F` (f32) and `V` (three f32), the first nine `V` registers filled with the shading
//! point before each run ([`Context`]); instructions of six 32-bit words `op d a b c k` with
//! stable opcodes ([`op`]); a table of `f32` constants; a table of images (indices into the
//! scene's `IMGS`); fifteen outputs, in the order of the output node's inputs ([`OUTPUT_KEYS`]);
//! and two values of the material, not of the point: the absorption distance and the thin walls.
//! [`Program::decode`] reads the bytes of `encodeProgram` and checks everything the interpreter
//! relies on (opcodes, register and constant indices, a value is written before it is read, a
//! destination is never an operand of its own instruction), so [`interp`] runs without a check
//! per instruction and the reference interpreter in TypeScript (`src/core/material-interp.ts`)
//! and this one agree on every program they both accept.
//!
//! * [`interp`]: the interpreter (fixed-size registers on the stack, no allocation, `f32` in the
//!   written order, [`crate::fmath`] for the elementary functions), the same bits as the
//!   reference at the points of the cross test.
//! * [`noise`]: the gradient noise of the contract (Perlin's improved noise and simplex noise with
//!   a hash per lattice corner, summed over octaves).
//! * [`shade`]: what a program makes of a hit (the shading point in the part's space, the
//!   material, the bent normal, the emission, the bevel's weight, the curvature).
//! * [`build`]: programs written by hand (the engine's examples and tests).

pub mod build;
pub mod interp;
pub mod noise;
pub mod shade;

pub use interp::{Context, Host, Outputs};
pub use shade::{ProgramSetup, Resolved};

use std::fmt;

/// `RPGM`, little-endian: the first word of a program's bytes.
pub const MAGIC: u32 = 0x4d47_5052;
/// The version of the program contract this engine runs. A program of another version is a
/// newer file's: the material keeps its plain values.
pub const VERSION: u32 = 1;
/// Words per instruction.
pub const WORDS: usize = 6;
/// An operand that is not there.
pub const NONE: u32 = u32::MAX;
/// The `V` registers the engine fills before a run: the shading point.
pub const CTX_COUNT: usize = 9;
/// Most instructions of a program.
pub const MAX_INSTRUCTIONS: usize = 2048;
/// Most `F` registers.
pub const MAX_F: usize = 256;
/// Most `V` registers, the nine of the shading point included.
pub const MAX_V: usize = 256;
/// Most constants.
pub const MAX_CONSTS: usize = 8192;
/// Most images.
pub const MAX_IMAGES: usize = 16;
/// The outputs of a material program, in this order.
pub const OUTPUT_KEYS: [&str; OUTPUTS] = [
    "baseColor",
    "metallic",
    "roughness",
    "anisotropic",
    "coat",
    "coatRoughness",
    "transmission",
    "ior",
    "subsurface",
    "emission",
    "emissionStrength",
    "opacity",
    "normal",
    "bump",
    "bevel",
];
/// Number of outputs of a material program.
pub const OUTPUTS: usize = 15;
/// Output 0: the base colour (vec3).
pub const OUT_BASE_COLOR: usize = 0;
/// Output 1: the metal (f32).
pub const OUT_METALLIC: usize = 1;
/// Output 2: the roughness.
pub const OUT_ROUGHNESS: usize = 2;
/// Output 3: the anisotropy.
pub const OUT_ANISOTROPY: usize = 3;
/// Output 4: the clear coat.
pub const OUT_COAT: usize = 4;
/// Output 5: the clear coat's roughness.
pub const OUT_COAT_ROUGHNESS: usize = 5;
/// Output 6: the transmission.
pub const OUT_TRANSMISSION: usize = 6;
/// Output 7: the index of refraction.
pub const OUT_IOR: usize = 7;
/// Output 8: the subsurface weight (not read: see [`shade`]).
pub const OUT_SUBSURFACE: usize = 8;
/// Output 9: the emitted colour (vec3).
pub const OUT_EMISSION: usize = 9;
/// Output 10: the emission's strength (radiance per unit of colour).
pub const OUT_EMISSION_STRENGTH: usize = 10;
/// Output 11: the opacity.
pub const OUT_OPACITY: usize = 11;
/// Output 12: the shading normal, part space, outward (vec3; the bump already applied).
pub const OUT_NORMAL: usize = 12;
/// Output 13: the bump's height (already applied to the normal; not read).
pub const OUT_BUMP: usize = 13;
/// Output 14: the bevel's weight, 0 to 1 of the material's radius.
pub const OUT_BEVEL: usize = 14;
/// Program `flags` bit 0: the material's clear part has thin walls.
pub const FLAG_THIN_WALLS: u32 = 1;

/// The opcodes. Stable: a new one takes a new number, none changes its meaning.
#[allow(missing_docs)]
pub mod op {
    pub const NOP: u32 = 0;
    pub const FCONST: u32 = 1;
    pub const VCONST: u32 = 2;
    pub const FMOV: u32 = 3;
    pub const VMOV: u32 = 4;
    pub const F2V: u32 = 5;
    pub const VLUM: u32 = 6;
    pub const VAVG: u32 = 7;
    pub const VX: u32 = 8;
    pub const VY: u32 = 9;
    pub const VZ: u32 = 10;
    pub const VCOMB: u32 = 11;
    pub const FADD: u32 = 20;
    pub const FSUB: u32 = 21;
    pub const FMUL: u32 = 22;
    pub const FDIV: u32 = 23;
    pub const FPOW: u32 = 24;
    pub const FMIN: u32 = 25;
    pub const FMAX: u32 = 26;
    pub const FSMIN: u32 = 27;
    pub const FSMAX: u32 = 28;
    pub const FABS: u32 = 29;
    pub const FSSTEP: u32 = 30;
    pub const FMADD: u32 = 31;
    pub const FLT: u32 = 32;
    pub const FGT: u32 = 33;
    pub const FFLOOR: u32 = 34;
    pub const FFRACT: u32 = 35;
    pub const FSIN: u32 = 36;
    pub const FCLAMP: u32 = 37;
    pub const FLERP: u32 = 38;
    pub const FINV: u32 = 39;
    pub const VADD: u32 = 50;
    pub const VSUB: u32 = 51;
    pub const VMUL: u32 = 52;
    pub const VSCALE: u32 = 53;
    pub const VLERP: u32 = 54;
    pub const VCLAMP: u32 = 55;
    pub const VNORM: u32 = 56;
    pub const VINV: u32 = 57;
    pub const VDOT: u32 = 58;
    pub const VLEN: u32 = 59;
    pub const BLEND: u32 = 70;
    pub const MAP: u32 = 80;
    pub const TEX: u32 = 90;
    pub const NOISE: u32 = 100;
    pub const NOISEC: u32 = 101;
    pub const GRAD: u32 = 110;
    pub const CHECK: u32 = 111;
    pub const STRIPE: u32 = 112;
    pub const RAMP: u32 = 113;
    pub const FRESNEL: u32 = 120;
    pub const FACING: u32 = 121;
    pub const EDGE: u32 = 122;
    pub const CAVITY: u32 = 123;
    pub const NMAP: u32 = 124;
    pub const BUMP: u32 = 125;
    // M3c: the patterns of E6 as nodes. Each reads a point (`a`, part space, mm) and a normal (`b`)
    // and the 25 constants of its recipe at `k` ([`super::PATTERN_CONSTS`]).
    pub const WOOD: u32 = 130;
    pub const WOODR: u32 = 131;
    pub const WOODH: u32 = 132;
    pub const WOODN: u32 = 133;
    pub const CLOTH: u32 = 140;
    pub const CLOTHR: u32 = 141;
    pub const CLOTHH: u32 = 142;
    pub const CLOTHN: u32 = 143;
}

/// M3c: the constants of a pattern instruction's recipe, as `PATN` holds it: the two colours
/// (linear RGB), the scale in millimetres, the sixteen parameters, the variant (figure or weave)
/// and the seed (both whole numbers, read as `ToUint32`).
pub const PATTERN_CONSTS: usize = 25;

/// What an operand of an opcode is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Slot {
    /// Not used (must be `NONE` or anything: ignored).
    No,
    /// An `F` register.
    F,
    /// A `V` register.
    V,
}

/// What `k` of an opcode is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KSlot {
    /// Not used.
    No,
    /// An index into the constants with this many after it (RAMP: its own count).
    Consts(usize),
    /// An index into the image table.
    Image,
    /// An immediate (a mode or a kind).
    Imm,
}

/// The operands of an opcode: `d a b c k`, and whether `b` is a second destination (TEX's alpha,
/// which may be `NONE`).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Shape {
    pub d: Slot,
    pub a: Slot,
    pub b: Slot,
    pub c: Slot,
    pub k: KSlot,
    pub b_def: bool,
}

const fn shape(d: Slot, a: Slot, b: Slot, c: Slot, k: KSlot) -> Shape {
    Shape {
        d,
        a,
        b,
        c,
        k,
        b_def: false,
    }
}

/// The operands of opcode `code` (the table of ARCHITECTURE §5.2 quater), `None` for an unknown
/// one.
pub(crate) fn shape_of(code: u32) -> Option<Shape> {
    use KSlot as K;
    use Slot::{No, F, V};
    Some(match code {
        op::NOP => shape(No, No, No, No, K::No),
        op::FCONST => shape(F, No, No, No, K::Consts(1)),
        op::VCONST => shape(V, No, No, No, K::Consts(3)),
        op::FMOV => shape(F, F, No, No, K::No),
        op::VMOV => shape(V, V, No, No, K::No),
        op::F2V => shape(V, F, No, No, K::No),
        op::VLUM | op::VAVG | op::VX | op::VY | op::VZ => shape(F, V, No, No, K::No),
        op::VCOMB => shape(V, F, F, F, K::No),
        op::FADD
        | op::FSUB
        | op::FMUL
        | op::FDIV
        | op::FPOW
        | op::FMIN
        | op::FMAX
        | op::FLT
        | op::FGT => shape(F, F, F, No, K::No),
        op::FSMIN | op::FSMAX | op::FSSTEP | op::FMADD | op::FLERP => shape(F, F, F, F, K::No),
        op::FABS | op::FFLOOR | op::FFRACT | op::FSIN | op::FCLAMP | op::FINV => {
            shape(F, F, No, No, K::No)
        }
        op::VADD | op::VSUB | op::VMUL | op::VNORM => shape(V, V, V, No, K::No),
        op::VSCALE => shape(V, V, F, No, K::No),
        op::VLERP => shape(V, V, V, F, K::No),
        op::VCLAMP | op::VINV => shape(V, V, No, No, K::No),
        op::VDOT => shape(F, V, V, No, K::No),
        op::VLEN => shape(F, V, No, No, K::No),
        op::BLEND => shape(V, V, V, F, K::Imm),
        op::MAP => shape(V, V, V, V, K::Consts(9)),
        op::TEX => Shape {
            b_def: true,
            ..shape(V, V, F, No, K::Image)
        },
        op::NOISE => shape(F, V, F, No, K::Consts(5)),
        op::NOISEC => shape(V, V, F, No, K::Consts(5)),
        op::GRAD => shape(F, V, No, No, K::Imm),
        op::CHECK => shape(F, V, F, No, K::No),
        op::STRIPE => shape(F, V, F, F, K::Consts(2)),
        op::RAMP => shape(V, F, No, No, K::Consts(2)),
        op::FRESNEL | op::FACING => shape(F, F, V, V, K::No),
        op::EDGE | op::CAVITY => shape(F, No, No, No, K::Consts(1)),
        op::NMAP => shape(V, V, F, V, K::Imm),
        op::BUMP => shape(V, V, F, F, K::No),
        op::WOOD | op::WOODN | op::CLOTH | op::CLOTHN => {
            shape(V, V, V, No, K::Consts(PATTERN_CONSTS))
        }
        op::WOODH | op::CLOTHH => shape(F, V, V, No, K::Consts(PATTERN_CONSTS)),
        op::WOODR | op::CLOTHR => shape(F, V, V, F, K::Consts(PATTERN_CONSTS)),
        _ => return None,
    })
}

/// One instruction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Instr {
    /// The opcode ([`op`]).
    pub op: u32,
    /// Destination register.
    pub d: u32,
    /// Operands (registers, or [`NONE`]).
    pub a: u32,
    /// Second operand (TEX: the alpha's destination).
    pub b: u32,
    /// Third operand.
    pub c: u32,
    /// Constant index, image index or immediate.
    pub k: u32,
}

/// Where a value of the program ends: a register or constants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueRef {
    /// An f32 constant at this index.
    FConst(u32),
    /// An `F` register.
    F(u32),
    /// Three constants from this index.
    VConst(u32),
    /// A `V` register.
    V(u32),
}

impl ValueRef {
    /// True for the vec3 kinds.
    pub fn is_vec(self) -> bool {
        matches!(self, ValueRef::VConst(_) | ValueRef::V(_))
    }

    /// The kind code of the bytes (0 f32 constant, 1 `F`, 2 vec3 constant, 3 `V`) and the index.
    fn code(self) -> (u32, u32) {
        match self {
            ValueRef::FConst(i) => (0, i),
            ValueRef::F(i) => (1, i),
            ValueRef::VConst(i) => (2, i),
            ValueRef::V(i) => (3, i),
        }
    }
}

/// An entry of the image table: which `IMGS` image, read as colour (sRGB) or data, past its
/// edges.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramImage {
    /// Index into the scene's images; `None` (`0xFFFFFFFF`): missing (reads white, alpha 0).
    pub image: Option<u32>,
    /// The writer's colour space for it (it points at an `IMGS` entry of that space).
    pub srgb: bool,
    /// 0 repeat, 1 clamp, 2 mirror.
    pub wrap: u32,
}

/// A material program, checked ([`Program::decode`]).
#[derive(Clone, Debug, PartialEq)]
pub struct Program {
    /// The instructions.
    pub code: Vec<Instr>,
    /// The constants.
    pub consts: Vec<f32>,
    /// The image table.
    pub images: Vec<ProgramImage>,
    /// `F` registers used.
    pub nf: u32,
    /// `V` registers used, the nine of the shading point included.
    pub nv: u32,
    /// The outputs ([`OUTPUT_KEYS`] for a material's).
    pub outputs: Vec<ValueRef>,
    /// The material's absorption distance, mm (the output node's parameter).
    pub absorption_mm: f32,
    /// `FLAG_*` bits of the material.
    pub flags: u32,
}

/// Why program bytes are not a program this engine runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgramError {
    /// Another version of the contract (a newer file's): skipped.
    Version(u32),
    /// Not a valid program.
    Invalid(&'static str),
}

impl fmt::Display for ProgramError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProgramError::Version(v) => write!(f, "material program of version {v}"),
            ProgramError::Invalid(reason) => write!(f, "invalid material program: {reason}"),
        }
    }
}

impl std::error::Error for ProgramError {}

/// Little-endian words of a byte slice.
struct Words<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Words<'_> {
    fn u32(&mut self) -> Result<u32, ProgramError> {
        let b = self
            .bytes
            .get(self.at..self.at + 4)
            .ok_or(ProgramError::Invalid("truncated"))?;
        self.at += 4;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f32(&mut self) -> Result<f32, ProgramError> {
        let v = f32::from_bits(self.u32()?);
        if v.is_finite() {
            Ok(v)
        } else {
            Err(ProgramError::Invalid("non-finite number"))
        }
    }
}

impl Program {
    /// Reads the bytes of `encodeProgram` (ARCHITECTURE §5.2 quater): a header of ten words
    /// (magic, version, counts of instructions, constants and images, `F` and `V` registers,
    /// outputs, the absorption distance as f32, flags), the instructions, the constants, the image
    /// table (three words each) and the outputs (two words each), and checks them. Trailing bytes
    /// are an error (the section says how long the program is).
    pub fn decode(bytes: &[u8]) -> Result<Program, ProgramError> {
        let mut w = Words { bytes, at: 0 };
        if w.u32()? != MAGIC {
            return Err(ProgramError::Invalid("not a material program"));
        }
        let version = w.u32()?;
        if version != VERSION {
            return Err(ProgramError::Version(version));
        }
        let n = w.u32()? as usize;
        let nc = w.u32()? as usize;
        let ni = w.u32()? as usize;
        let nf = w.u32()?;
        let nv = w.u32()?;
        let no = w.u32()? as usize;
        let absorption_mm = w.f32()?;
        let flags = w.u32()?;
        if n > MAX_INSTRUCTIONS
            || nc > MAX_CONSTS
            || ni > MAX_IMAGES
            || nf as usize > MAX_F
            || nv as usize > MAX_V
            || (nv as usize) < CTX_COUNT
            || no > 1024
        {
            return Err(ProgramError::Invalid("a count is past its limit"));
        }
        let need = 40 + n * WORDS * 4 + nc * 4 + ni * 12 + no * 8;
        if bytes.len() != need {
            return Err(ProgramError::Invalid("the size does not match the counts"));
        }
        if absorption_mm < 0.0 {
            return Err(ProgramError::Invalid("negative absorption distance"));
        }
        let mut code = Vec::with_capacity(n);
        for _ in 0..n {
            code.push(Instr {
                op: w.u32()?,
                d: w.u32()?,
                a: w.u32()?,
                b: w.u32()?,
                c: w.u32()?,
                k: w.u32()?,
            });
        }
        let mut consts = Vec::with_capacity(nc);
        for _ in 0..nc {
            consts.push(w.f32()?);
        }
        let mut images = Vec::with_capacity(ni);
        for _ in 0..ni {
            let image = w.u32()?;
            let srgb = w.u32()?;
            let wrap = w.u32()?;
            if srgb > 1 || wrap > 2 {
                return Err(ProgramError::Invalid("bad image colour space or wrap"));
            }
            images.push(ProgramImage {
                image: (image != NONE).then_some(image),
                srgb: srgb == 1,
                wrap,
            });
        }
        let mut outputs = Vec::with_capacity(no);
        for _ in 0..no {
            let kind = w.u32()?;
            let index = w.u32()?;
            outputs.push(match kind {
                0 => ValueRef::FConst(index),
                1 => ValueRef::F(index),
                2 => ValueRef::VConst(index),
                3 => ValueRef::V(index),
                _ => return Err(ProgramError::Invalid("unknown output kind")),
            });
        }
        let program = Program {
            code,
            consts,
            images,
            nf,
            nv,
            outputs,
            absorption_mm,
            flags,
        };
        program.check()?;
        Ok(program)
    }

    /// The bytes of the program (what [`Program::decode`] reads; the page's `encodeProgram`).
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(
            40 + self.code.len() * WORDS * 4
                + self.consts.len() * 4
                + self.images.len() * 12
                + self.outputs.len() * 8,
        );
        let mut u32 = |v: u32| out.extend_from_slice(&v.to_le_bytes());
        u32(MAGIC);
        u32(VERSION);
        u32(self.code.len() as u32);
        u32(self.consts.len() as u32);
        u32(self.images.len() as u32);
        u32(self.nf);
        u32(self.nv);
        u32(self.outputs.len() as u32);
        u32(self.absorption_mm.to_bits());
        u32(self.flags);
        for i in &self.code {
            for v in [i.op, i.d, i.a, i.b, i.c, i.k] {
                u32(v);
            }
        }
        for c in &self.consts {
            u32(c.to_bits());
        }
        for im in &self.images {
            u32(im.image.unwrap_or(NONE));
            u32(u32::from(im.srgb));
            u32(im.wrap);
        }
        for o in &self.outputs {
            let (kind, index) = o.code();
            u32(kind);
            u32(index);
        }
        out
    }

    /// True when the material's clear part has thin walls.
    pub fn thin_walls(&self) -> bool {
        self.flags & FLAG_THIN_WALLS != 0
    }

    /// The checks of [`Program::decode`]: every opcode known, every register of an operand in its
    /// file and written before it is read (the nine of the shading point are written), a
    /// destination never an operand of its own instruction, every constant, image and immediate
    /// index in range, every output's register written by the end.
    fn check(&self) -> Result<(), ProgramError> {
        let bad = ProgramError::Invalid;
        let (nf, nv) = (self.nf as usize, self.nv as usize);
        let mut wf = [false; MAX_F];
        let mut wv = [false; MAX_V];
        for v in wv.iter_mut().take(CTX_COUNT) {
            *v = true;
        }
        let read = |slot: Slot, r: u32, wf: &[bool; MAX_F], wv: &[bool; MAX_V]| -> bool {
            let r = r as usize;
            match slot {
                Slot::No => true,
                Slot::F => r < nf && wf[r],
                Slot::V => r < nv && wv[r],
            }
        };
        for i in &self.code {
            let s = shape_of(i.op).ok_or(bad("unknown opcode"))?;
            if !read(s.a, i.a, &wf, &wv) || !read(s.c, i.c, &wf, &wv) {
                return Err(bad("an operand is not a written register"));
            }
            if !s.b_def && !read(s.b, i.b, &wf, &wv) {
                return Err(bad("an operand is not a written register"));
            }
            // Destinations: in their file, never an operand of the same file here.
            let same = |slot: Slot, r: u32| -> bool {
                [(s.a, i.a), (s.b, i.b), (s.c, i.c)]
                    .iter()
                    .enumerate()
                    .any(|(at, &(sl, x))| sl == slot && x == r && !(at == 1 && s.b_def))
            };
            match s.d {
                Slot::No => {}
                Slot::F => {
                    if i.d as usize >= nf || same(Slot::F, i.d) {
                        return Err(bad("bad destination"));
                    }
                }
                Slot::V => {
                    if i.d as usize >= nv || (i.d as usize) < CTX_COUNT || same(Slot::V, i.d) {
                        return Err(bad("bad destination"));
                    }
                }
            }
            if s.b_def && i.b != NONE && (i.b as usize >= nf || same(Slot::F, i.b)) {
                return Err(bad("bad destination"));
            }
            match s.k {
                KSlot::No | KSlot::Imm => {}
                KSlot::Image => {
                    if i.k as usize >= self.images.len() {
                        return Err(bad("image index out of range"));
                    }
                }
                KSlot::Consts(count) => {
                    let k = i.k as usize;
                    let mut need = count;
                    if i.op == op::RAMP {
                        let stops = *self.consts.get(k).ok_or(bad("constant out of range"))?;
                        if !((1.0..=64.0).contains(&stops) && stops == stops.floor()) {
                            return Err(bad("a ramp needs 1 to 64 stops"));
                        }
                        need = 2 + 4 * stops as usize;
                    }
                    if k.checked_add(need)
                        .is_none_or(|end| end > self.consts.len())
                    {
                        return Err(bad("constant out of range"));
                    }
                }
            }
            match s.d {
                Slot::F => wf[i.d as usize] = true,
                Slot::V => wv[i.d as usize] = true,
                Slot::No => {}
            }
            if s.b_def && i.b != NONE {
                wf[i.b as usize] = true;
            }
        }
        for o in &self.outputs {
            let ok = match *o {
                ValueRef::FConst(k) => (k as usize) < self.consts.len(),
                ValueRef::VConst(k) => (k as usize)
                    .checked_add(3)
                    .is_some_and(|e| e <= self.consts.len()),
                ValueRef::F(r) => (r as usize) < nf && wf[r as usize],
                ValueRef::V(r) => (r as usize) < nv && wv[r as usize],
            };
            if !ok {
                return Err(bad("an output is not a written register or a constant"));
            }
        }
        Ok(())
    }

    /// True when this program can be a material's: its fifteen outputs have the types of the
    /// output node's inputs (vec3 for the colour, the emission and the normal).
    pub fn is_material(&self) -> bool {
        self.outputs.len() == OUTPUTS
            && self
                .outputs
                .iter()
                .enumerate()
                .all(|(i, o)| o.is_vec() == matches!(i, OUT_BASE_COLOR | OUT_EMISSION | OUT_NORMAL))
    }

    /// The constant value of output `i` when it is one (the first component of a vec3).
    pub fn constant(&self, i: usize) -> Option<[f32; 3]> {
        match *self.outputs.get(i)? {
            ValueRef::FConst(k) => Some([self.consts[k as usize], 0.0, 0.0]),
            ValueRef::VConst(k) => {
                let k = k as usize;
                Some([self.consts[k], self.consts[k + 1], self.consts[k + 2]])
            }
            _ => None,
        }
    }

    /// True when some instruction is `opcode`.
    pub fn uses(&self, opcode: u32) -> bool {
        self.code.iter().any(|i| i.op == opcode)
    }

    /// M3c: the pattern of a pattern instruction (`WOOD*`, `CLOTH*`), decoded from its constants
    /// as `PATN` would hold them; `None` for another opcode.
    pub fn pattern_of(&self, ins: &Instr) -> Option<crate::pattern::Pattern> {
        let kind = pattern_kind(ins.op)?;
        let c = self
            .consts
            .get(ins.k as usize..ins.k as usize + PATTERN_CONSTS)?;
        let mut params = [0.0f32; crate::pattern::PARAMS];
        params.copy_from_slice(&c[7..7 + crate::pattern::PARAMS]);
        Some(crate::pattern::Pattern {
            material: 0,
            kind,
            color_a: crate::color::Rgb::new(c[0], c[1], c[2]),
            color_b: crate::color::Rgb::new(c[3], c[4], c[5]),
            scale_mm: c[6],
            params,
            variant: noise::seed_of(c[23]),
            seed: noise::seed_of(c[24]),
        })
    }
}

/// The `PATN` kind a pattern opcode draws (wood or cloth), `None` for any other.
pub fn pattern_kind(code: u32) -> Option<u32> {
    match code {
        op::WOOD | op::WOODR | op::WOODH | op::WOODN => Some(crate::pattern::PATTERN_WOOD),
        op::CLOTH | op::CLOTHR | op::CLOTHH | op::CLOTHN => Some(crate::pattern::PATTERN_CLOTH),
        _ => None,
    }
}

#[cfg(test)]
mod pattern_tests;
#[cfg(test)]
mod scene_tests;
#[cfg(test)]
mod tests;

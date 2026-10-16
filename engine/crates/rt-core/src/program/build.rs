//! Writing material programs by hand (the engine's own examples and tests; the page compiles its
//! graphs, `src/core/material-program.ts`): a register for every value, never reused, so no
//! destination is ever an operand of its own instruction; the outputs start as the output node's
//! defaults (`src/data/material-nodes.ts`).

use super::{
    op, Instr, Program, ProgramImage, ValueRef, CTX_COUNT, FLAG_THIN_WALLS, NONE, OUTPUTS,
    OUT_BASE_COLOR, OUT_BEVEL, OUT_COAT_ROUGHNESS, OUT_EMISSION, OUT_EMISSION_STRENGTH, OUT_IOR,
    OUT_NORMAL, OUT_OPACITY, OUT_ROUGHNESS,
};

/// The shading point's position register.
pub const P: u32 = 0;
/// Its normal.
pub const N: u32 = 1;
/// Its first UV set.
pub const UV0: u32 = 2;
/// Its second UV set.
pub const UV1: u32 = 3;
/// The direction to the viewer.
pub const I: u32 = 4;
/// The tangent.
pub const T: u32 = 5;
/// The bitangent `N × T`.
pub const B: u32 = 6;

/// A material program being written.
#[derive(Clone, Debug)]
pub struct Builder {
    code: Vec<Instr>,
    consts: Vec<f32>,
    images: Vec<ProgramImage>,
    nf: u32,
    nv: u32,
    outputs: Vec<ValueRef>,
    absorption_mm: f32,
    flags: u32,
}

impl Default for Builder {
    fn default() -> Builder {
        Builder::new()
    }
}

impl Builder {
    /// An empty program whose outputs are the output node's defaults: base colour 0.8 grey,
    /// roughness 0.5, coat roughness 0.03, IOR 1.5, emission black at strength 1, opacity 1, the
    /// point's normal, bevel weight 1, the rest 0.
    pub fn new() -> Builder {
        let mut b = Builder {
            code: Vec::new(),
            consts: Vec::new(),
            images: Vec::new(),
            nf: 0,
            nv: CTX_COUNT as u32,
            outputs: Vec::new(),
            absorption_mm: 0.0,
            flags: 0,
        };
        let zero = b.konst(&[0.0]);
        b.outputs = vec![ValueRef::FConst(zero); OUTPUTS];
        let grey = b.konst(&[0.8, 0.8, 0.8]);
        b.outputs[OUT_BASE_COLOR] = ValueRef::VConst(grey);
        let black = b.konst(&[0.0, 0.0, 0.0]);
        b.outputs[OUT_EMISSION] = ValueRef::VConst(black);
        b.outputs[OUT_NORMAL] = ValueRef::V(N);
        for (o, v) in [
            (OUT_ROUGHNESS, 0.5),
            (OUT_COAT_ROUGHNESS, 0.03),
            (OUT_IOR, 1.5),
            (OUT_EMISSION_STRENGTH, 1.0),
            (OUT_OPACITY, 1.0),
            (OUT_BEVEL, 1.0),
        ] {
            let k = b.konst(&[v]);
            b.outputs[o] = ValueRef::FConst(k);
        }
        b
    }

    /// Constants; their index.
    pub fn konst(&mut self, xs: &[f32]) -> u32 {
        let at = self.consts.len() as u32;
        self.consts.extend_from_slice(xs);
        at
    }

    fn emit(&mut self, op: u32, d: u32, a: u32, b: u32, c: u32, k: u32) {
        self.code.push(Instr { op, d, a, b, c, k });
    }

    /// An instruction writing a new `F` register: its number.
    pub fn f(&mut self, op: u32, a: u32, b: u32, c: u32, k: u32) -> u32 {
        let d = self.nf;
        self.nf += 1;
        self.emit(op, d, a, b, c, k);
        d
    }

    /// An instruction writing a new `V` register: its number.
    pub fn v(&mut self, op: u32, a: u32, b: u32, c: u32, k: u32) -> u32 {
        let d = self.nv;
        self.nv += 1;
        self.emit(op, d, a, b, c, k);
        d
    }

    /// A scalar constant in a register.
    pub fn fconst(&mut self, x: f32) -> u32 {
        let k = self.konst(&[x]);
        self.f(op::FCONST, NONE, NONE, NONE, k)
    }

    /// A vector constant in a register.
    pub fn vconst(&mut self, x: [f32; 3]) -> u32 {
        let k = self.konst(&x);
        self.v(op::VCONST, NONE, NONE, NONE, k)
    }

    /// `MAP` of the point with projection `proj` (0 UV, 1 planar, 2 box, 3 cylindrical, 4
    /// spherical, 5 object) about `axis` (0 X, 1 Y, 2 Z), `size` mm, turned `turn_deg`, with
    /// `repeat` and `offset`; the first UV set.
    pub fn map(
        &mut self,
        proj: f32,
        axis: f32,
        size: f32,
        turn_deg: f32,
        repeat: [f32; 2],
        offset: [f32; 2],
    ) -> u32 {
        let (s, c) = crate::fmath::sin_cos(turn_deg * crate::fmath::DEG_TO_RAD);
        let k = self.konst(&[
            proj, axis, size, c, s, repeat[0], repeat[1], offset[0], offset[1],
        ]);
        self.v(op::MAP, P, N, UV0, k)
    }

    /// `NOISE` (`simplex` or Perlin) of `at` scaled by `scale`: octaves, lacunarity, gain, seed.
    pub fn noise(&mut self, at: u32, scale: f32, simplex: bool, octaves: f32, seed: f32) -> u32 {
        let s = self.fconst(scale);
        let k = self.konst(&[f32::from(u8::from(simplex)), octaves, 2.0, 0.5, seed]);
        self.f(op::NOISE, at, s, NONE, k)
    }

    /// `RAMP` of `x` through `stops` (position, colour), sorted; `interp` 0 linear, 1 eased, 2
    /// constant.
    pub fn ramp(&mut self, x: u32, interp: f32, stops: &[(f32, [f32; 3])]) -> u32 {
        let mut c = vec![stops.len() as f32, interp];
        for (p, rgb) in stops {
            c.extend_from_slice(&[*p, rgb[0], rgb[1], rgb[2]]);
        }
        let k = self.konst(&c);
        self.v(op::RAMP, x, NONE, NONE, k)
    }

    /// An entry of the image table: the scene image `image`, read as colour or data, past its
    /// edges by `wrap`.
    pub fn image(&mut self, image: Option<u32>, srgb: bool, wrap: u32) -> u32 {
        self.images.push(ProgramImage { image, srgb, wrap });
        (self.images.len() - 1) as u32
    }

    /// `TEX` of image `entry` at `coords`: (colour register, alpha register).
    pub fn tex(&mut self, entry: u32, coords: u32) -> (u32, u32) {
        let alpha = self.nf;
        self.nf += 1;
        let rgb = self.nv;
        self.nv += 1;
        self.emit(op::TEX, rgb, coords, alpha, NONE, entry);
        (rgb, alpha)
    }

    /// Output `index` from a register (`vec`: a `V` one).
    pub fn out(&mut self, index: usize, reg: u32, vec: bool) {
        self.outputs[index] = if vec {
            ValueRef::V(reg)
        } else {
            ValueRef::F(reg)
        };
    }

    /// Output `index` as a constant.
    pub fn out_const(&mut self, index: usize, value: &[f32]) {
        let k = self.konst(value);
        self.outputs[index] = if value.len() == 3 {
            ValueRef::VConst(k)
        } else {
            ValueRef::FConst(k)
        };
    }

    /// The material's absorption distance and thin walls (the output node's parameters).
    pub fn material(&mut self, absorption_mm: f32, thin_walls: bool) {
        self.absorption_mm = absorption_mm;
        self.flags = if thin_walls { FLAG_THIN_WALLS } else { 0 };
    }

    /// The program, checked.
    pub fn build(self) -> Program {
        let p = Program {
            code: self.code,
            consts: self.consts,
            images: self.images,
            nf: self.nf,
            nv: self.nv,
            outputs: self.outputs,
            absorption_mm: self.absorption_mm,
            flags: self.flags,
        };
        match Program::decode(&p.encode()) {
            Ok(checked) => checked,
            Err(e) => panic!("a hand-written program is invalid: {e}"),
        }
    }
}

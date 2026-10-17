//! The interpreter of material programs: each instruction of ARCHITECTURE §5.2 quater in `f32`,
//! step by step in the written order (`(a·b) + c` is two roundings, never fused; `min(a, b)` is
//! `b < a ? b : a`, never `f32::min`, so a NaN goes through the same way as in the reference),
//! with the elementary functions of [`crate::fmath`]. The reference is `src/core/material-interp.ts`
//! (`ProgramRunner`): the cross test pins both to the same bits at 1000 points per example graph.
//!
//! **Registers** live on the stack in fixed-size arrays (`MAX_F` and `MAX_V`): a run allocates
//! nothing. A checked program ([`super::Program::decode`]) never reads a register before writing
//! it, so what an earlier run left in them does not matter.
//!
//! **Images** (`TEX`) are read through [`crate::texture::TextureImage::sample`], the reading of M2b
//! (bilinear on a level, trilinear between two), on the level of detail the footprint of the ray
//! asks for: for a read whose coordinates come from a `MAP` (or straight from a UV set), the
//! change of those coordinates across the footprint's two axes, as M2b measures it for a texture
//! slot; every read of the same image through the same mapping takes the level of the first one
//! (the three evaluations of a bump read their heights on one level, or the slope would be the
//! difference of two filters). A read whose coordinates are computed otherwise, and every read
//! without a footprint (shadow rays, the cross test), is on level 0: the contract's bilinear
//! reading.

use super::noise;
use super::{op, Instr, Program, ValueRef, CTX_COUNT, MAX_F, MAX_V, NONE, OUTPUTS};
use crate::fmath;
use crate::math::Vec3;
use crate::pattern::{sample_at, Placement, Recipe, Sampled};
use crate::texture::TextureImage;
use std::sync::Arc;

/// The shading point a program runs at, in the part's own space: the nine `V` registers the
/// engine fills before a run.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Context {
    /// `V0` `P`: position, mm.
    pub p: [f32; 3],
    /// `V1` `N`: shading normal, unit, outward.
    pub n: [f32; 3],
    /// `V2` `UV0`: the first UV set `(u, v, 0)`; zero without UVs.
    pub uv0: [f32; 3],
    /// `V3` `UV1`: the second one; the first when the mesh has one.
    pub uv1: [f32; 3],
    /// `V4` `I`: unit direction from the point to the viewer.
    pub i: [f32; 3],
    /// `V5` `T`: unit tangent along the first set's u (`onb(N)` without UVs).
    pub t: [f32; 3],
    /// `V6` `B`: `N × T`.
    pub b: [f32; 3],
    /// `V7`: `(du/dT, dv/dT, 0)` of the first set, per mm.
    pub duv_t: [f32; 3],
    /// `V8`: `(du/dB, dv/dB, 0)`.
    pub duv_b: [f32; 3],
}

/// The footprint of the ray at the point, for the level of detail of the image reads: its two
/// axes in the part's space and how much each UV set changes along them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Footprint {
    /// The first axis (mm, part space).
    pub dx: [f32; 3],
    /// The second axis.
    pub dy: [f32; 3],
    /// `[set][axis] = (du, dv)`: the change of UV set `set` along axis `axis`.
    pub duv: [[[f32; 2]; 2]; 2],
}

/// What a run asks of where it runs: the footprint and the curvature of the part (`EDGE` and
/// `CAVITY`, measured by the engine; 0 where there is no geometry around the point).
pub trait Host {
    /// The footprint of the ray (`None`: every read on level 0).
    fn footprint(&self) -> Option<&Footprint>;
    /// The convexity of the part at the point within `radius` mm, 0 to 1.
    fn edge(&mut self, radius: f32) -> f32;
    /// The concavity, 0 to 1.
    fn cavity(&mut self, radius: f32) -> f32;
    /// M3c: where the pattern of the instructions with recipe constants `k` and `PATN` kind `kind`
    /// lies in the part (its frame and its knots); `None`: [`Placement::IDENTITY`], the frame of
    /// the point's own space (a host without a part).
    fn placement(&mut self, _k: u32, _kind: u32) -> Option<&Placement> {
        None
    }
    /// M3c: the direction (part space) a pattern stretches the roughness along at the point,
    /// told for every pattern sampled that has one, in program order.
    fn grain(&mut self, _tangent: Vec3) {}
}

/// The placement of a pattern without a part ([`Placement::IDENTITY`]).
static IDENTITY: Placement = Placement::IDENTITY;

/// A host without geometry and without footprint (the cross test's, the reference's): curvature
/// 0, every image on level 0.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoHost;

impl Host for NoHost {
    fn footprint(&self) -> Option<&Footprint> {
        None
    }
    fn edge(&mut self, _radius: f32) -> f32 {
        0.0
    }
    fn cavity(&mut self, _radius: f32) -> f32 {
        0.0
    }
}

/// The outputs of a run: a scalar in the first component, a vec3 in the three.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Outputs {
    /// By output index ([`super::OUTPUT_KEYS`] for a material's program).
    pub values: [[f32; 3]; OUTPUTS],
}

impl Outputs {
    /// The scalar output `i`.
    #[inline]
    pub fn scalar(&self, i: usize) -> f32 {
        self.values[i][0]
    }

    /// The vec3 output `i`.
    #[inline]
    pub fn vec(&self, i: usize) -> [f32; 3] {
        self.values[i]
    }
}

/// Where the level of detail of a `TEX` comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TexLod {
    /// Level 0.
    Zero,
    /// The slot a `MAP` before it sets.
    Slot(u8),
    /// The slot it sets itself from the UV set's change (when no read before it did).
    Uv { slot: u8, set: u8 },
}

/// Most level-of-detail slots of a program (one per image and mapping read); reads past them are
/// on level 0.
const LOD_SLOTS: usize = 32;

/// What a `MAP` sets: the slots (image `k`) whose level of detail it measures.
#[derive(Clone, Debug, Default, PartialEq)]
struct MapLod {
    /// `(slot, image)`.
    slots: Vec<(u8, u8)>,
    /// The UV set of its UV operand (`None`: computed otherwise; its change is taken as 0).
    set: Option<u8>,
}

/// A program ready to run: its images and the plan of its levels of detail.
#[derive(Clone, Debug, PartialEq)]
pub struct Runner {
    program: Program,
    /// One per entry of the image table: the image, `None` when missing.
    images: Vec<Option<Arc<TextureImage>>>,
    /// Per instruction: a `TEX`'s level of detail.
    tex: Vec<TexLod>,
    /// Per instruction: what a `MAP` measures (`None`: nothing).
    maps: Vec<Option<MapLod>>,
    /// Per instruction: a pattern instruction's recipe (`None`: another opcode, or a recipe that
    /// draws nothing).
    recipes: Vec<Option<Recipe>>,
}

impl Runner {
    /// `program` with `images`, one per entry of its image table (missing ones read white with
    /// alpha 0).
    pub fn new(program: Program, images: Vec<Option<Arc<TextureImage>>>) -> Runner {
        let n = program.code.len();
        let mut tex = vec![TexLod::Zero; n];
        let mut maps: Vec<Option<MapLod>> = vec![None; n];
        // The last instruction that wrote each V register (None: the shading point, or never).
        let mut writer: [Option<usize>; MAX_V] = [None; MAX_V];
        // The UV set each V register is (or is stepped from), when it is one.
        let mut uv_root: [Option<u8>; MAX_V] = [None; MAX_V];
        uv_root[2] = Some(0);
        uv_root[3] = Some(1);
        // The UV set of each MAP's UV operand when it ran.
        let mut map_set: Vec<Option<u8>> = vec![None; n];
        // Groups: (image, source) -> slot. A source is a MAP's constants and UV set, or a UV set.
        let mut groups: Vec<((u32, u32, u32), u8)> = Vec::new();
        for (at, ins) in program.code.iter().enumerate() {
            if ins.op == op::MAP {
                map_set[at] = uv_root[ins.c as usize];
            }
            if ins.op == op::TEX {
                let a = ins.a as usize;
                let key = match writer[a].map(|w| (w, program.code[w])) {
                    Some((w, m)) if m.op == op::MAP => {
                        Some(((ins.k, m.k, u32::from(map_set[w].unwrap_or(9))), w))
                    }
                    None => uv_root[a].map(|s| ((ins.k, u32::MAX, u32::from(s)), usize::MAX)),
                    Some((w, m)) if m.op == op::VADD && uv_root[a].is_some() => {
                        uv_root[a].map(|s| ((ins.k, u32::MAX, u32::from(s)), w))
                    }
                    _ => None,
                };
                if let Some((key, map_at)) = key {
                    let found = groups.iter().find(|g| g.0 == key).map(|g| g.1);
                    let slot = match found {
                        Some(s) => Some((s, false)),
                        None if groups.len() < LOD_SLOTS => {
                            let s = groups.len() as u8;
                            groups.push((key, s));
                            Some((s, true))
                        }
                        None => None,
                    };
                    if let Some((slot, new)) = slot {
                        if key.1 == u32::MAX {
                            tex[at] = TexLod::Uv {
                                slot,
                                set: key.2 as u8,
                            };
                        } else {
                            tex[at] = TexLod::Slot(slot);
                            if new {
                                let entry = maps[map_at].get_or_insert_with(|| MapLod {
                                    slots: Vec::new(),
                                    set: map_set[map_at],
                                });
                                entry.slots.push((slot, ins.k as u8));
                            }
                        }
                    }
                }
            }
            // What this instruction writes.
            let shape = super::shape_of(ins.op).expect("a checked program");
            if shape.d == super::Slot::V {
                let d = ins.d as usize;
                writer[d] = Some(at);
                uv_root[d] = match ins.op {
                    op::VADD => uv_root[ins.a as usize],
                    op::VMOV => uv_root[ins.a as usize],
                    _ => None,
                };
            }
        }
        let recipes = program
            .code
            .iter()
            .map(|ins| program.pattern_of(ins).and_then(|p| p.recipe()))
            .collect();
        Runner {
            program,
            images,
            tex,
            maps,
            recipes,
        }
    }

    /// M3c: the pattern instructions' recipes, each once: `(k, kind, recipe)`, in program order.
    pub(crate) fn patterns(&self) -> Vec<(u32, u32, Recipe)> {
        let mut out: Vec<(u32, u32, Recipe)> = Vec::new();
        for (ins, recipe) in self.program.code.iter().zip(&self.recipes) {
            let (Some(r), Some(kind)) = (recipe, super::pattern_kind(ins.op)) else {
                continue;
            };
            if !out.iter().any(|&(k, kd, _)| k == ins.k && kd == kind) {
                out.push((ins.k, kind, *r));
            }
        }
        out
    }

    /// The program.
    pub fn program(&self) -> &Program {
        &self.program
    }

    /// The images of its table.
    pub fn images(&self) -> &[Option<Arc<TextureImage>>] {
        &self.images
    }

    /// Runs the program at `ctx` with `host`, into `out` (a material program's fifteen outputs).
    #[inline]
    pub fn run<H: Host>(&self, ctx: &Context, host: &mut H, out: &mut Outputs) {
        self.run_into(ctx, host, &mut out.values);
    }

    /// Runs the program at `ctx` with `host`: its outputs, in order, into `out` (as many as both
    /// have).
    pub fn run_into<H: Host>(&self, ctx: &Context, host: &mut H, out: &mut [[f32; 3]]) {
        let mut f = [0.0f32; MAX_F];
        let mut v = [[0.0f32; 3]; MAX_V];
        v[0] = ctx.p;
        v[1] = ctx.n;
        v[2] = ctx.uv0;
        v[3] = ctx.uv1;
        v[4] = ctx.i;
        v[5] = ctx.t;
        v[6] = ctx.b;
        v[7] = ctx.duv_t;
        v[8] = ctx.duv_b;
        let mut lods = [f32::NAN; LOD_SLOTS];
        // M3c: the last pattern sampled (its constants, kind, point and normal), which the other
        // outputs of the same node read again.
        let mut last: Option<(u32, u32, [u32; 6], Sampled)> = None;
        let foot = host.footprint().copied();
        let c = &self.program.consts;
        for (at, ins) in self.program.code.iter().enumerate() {
            let Instr {
                op: code,
                d,
                a,
                b,
                c: cc,
                k,
            } = *ins;
            let (d, a, b, cr, ku) = (d as usize, a as usize, b as usize, cc as usize, k as usize);
            match code {
                op::NOP => {}
                op::FCONST => f[d] = c[ku],
                op::VCONST => v[d] = [c[ku], c[ku + 1], c[ku + 2]],
                op::FMOV => f[d] = f[a],
                op::VMOV => v[d] = v[a],
                op::F2V => v[d] = [f[a]; 3],
                op::VLUM => {
                    let x = v[a];
                    f[d] = ((x[0] * 0.2126) + (x[1] * 0.7152)) + (x[2] * 0.0722);
                }
                op::VAVG => {
                    let x = v[a];
                    f[d] = ((x[0] + x[1]) + x[2]) / 3.0;
                }
                op::VX => f[d] = v[a][0],
                op::VY => f[d] = v[a][1],
                op::VZ => f[d] = v[a][2],
                op::VCOMB => v[d] = [f[a], f[b], f[cr]],
                op::FADD => f[d] = f[a] + f[b],
                op::FSUB => f[d] = f[a] - f[b],
                op::FMUL => f[d] = f[a] * f[b],
                op::FDIV => f[d] = if f[b] == 0.0 { 0.0 } else { f[a] / f[b] },
                op::FPOW => f[d] = pow_op(f[a], f[b]),
                op::FMIN => f[d] = if f[b] < f[a] { f[b] } else { f[a] },
                op::FMAX => f[d] = if f[b] > f[a] { f[b] } else { f[a] },
                op::FSMIN => f[d] = smooth_min(f[a], f[b], f[cr]),
                op::FSMAX => f[d] = -smooth_min(-f[a], -f[b], f[cr]),
                op::FABS => f[d] = f[a].abs(),
                op::FSSTEP => f[d] = smoothstep(f[b], f[cr], f[a]),
                op::FMADD => f[d] = (f[a] * f[b]) + f[cr],
                op::FLT => f[d] = if f[a] < f[b] { 1.0 } else { 0.0 },
                op::FGT => f[d] = if f[a] > f[b] { 1.0 } else { 0.0 },
                op::FFLOOR => f[d] = f[a].floor(),
                op::FFRACT => f[d] = f[a] - f[a].floor(),
                op::FSIN => f[d] = fmath::sin(f[a]),
                op::FCLAMP => f[d] = clamp01(f[a]),
                op::FLERP => f[d] = lerp(f[a], f[b], f[cr]),
                op::FINV => f[d] = 1.0 - f[a],
                op::VADD => v[d] = per(v[a], v[b], |x, y| x + y),
                op::VSUB => v[d] = per(v[a], v[b], |x, y| x - y),
                op::VMUL => v[d] = per(v[a], v[b], |x, y| x * y),
                op::VSCALE => {
                    let s = f[b];
                    v[d] = v[a].map(|x| x * s);
                }
                op::VLERP => {
                    let t = f[cr];
                    v[d] = per(v[a], v[b], |x, y| lerp(x, y, t));
                }
                op::VCLAMP => v[d] = v[a].map(clamp01),
                op::VNORM => v[d] = normalize_or(v[a], v[b]),
                op::VINV => v[d] = v[a].map(|x| 1.0 - x),
                op::VDOT => f[d] = dot(v[a], v[b]),
                op::VLEN => f[d] = dot(v[a], v[a]).sqrt(),
                op::BLEND => v[d] = blend(k, v[a], v[b], clamp01(f[cr])),
                op::MAP => {
                    let m = &c[ku..ku + 9];
                    v[d] = map(m, v[a], v[b], v[cr]);
                    if let (Some(fp), Some(Some(plan))) = (foot.as_ref(), self.maps.get(at)) {
                        let (dx, dy) = map_change(m, v[a], v[b], v[cr], fp, plan.set);
                        for &(slot, image) in &plan.slots {
                            lods[slot as usize] = match &self.images[image as usize] {
                                Some(im) => im.lod(dx, dy),
                                None => 0.0,
                            };
                        }
                    }
                }
                op::TEX => {
                    let lod = match (self.tex[at], foot.as_ref()) {
                        (_, None) | (TexLod::Zero, _) => 0.0,
                        (TexLod::Slot(s), _) => lods[s as usize],
                        (TexLod::Uv { slot, set }, Some(fp)) => {
                            let s = slot as usize;
                            if lods[s].is_nan() {
                                let dd = fp.duv[set as usize];
                                lods[s] = match &self.images[ku] {
                                    Some(im) => im.lod((dd[0][0], dd[0][1]), (dd[1][0], dd[1][1])),
                                    None => 0.0,
                                };
                            }
                            lods[s]
                        }
                    };
                    let lod = if lod.is_nan() { 0.0 } else { lod };
                    let entry = self.program.images[ku];
                    let texel = match &self.images[ku] {
                        Some(im) => im.sample(v[a][0], v[a][1], lod, entry.wrap),
                        None => [1.0, 1.0, 1.0, 0.0],
                    };
                    v[d] = [texel[0], texel[1], texel[2]];
                    if ins.b != NONE {
                        f[b] = texel[3];
                    }
                }
                op::NOISE => {
                    let s = f[b];
                    let p = v[a];
                    f[d] = noise::fbm(
                        c[ku] == 1.0,
                        p[0] * s,
                        p[1] * s,
                        p[2] * s,
                        c[ku + 1],
                        c[ku + 2],
                        c[ku + 3],
                        noise::seed_of(c[ku + 4]),
                    );
                }
                op::NOISEC => {
                    let s = f[b];
                    let p = v[a];
                    let (x, y, z) = (p[0] * s, p[1] * s, p[2] * s);
                    let seed = noise::seed_of(c[ku + 4]);
                    let mut o = [0.0f32; 3];
                    for (ch, slot) in o.iter_mut().enumerate() {
                        *slot = noise::fbm(
                            c[ku] == 1.0,
                            x,
                            y,
                            z,
                            c[ku + 1],
                            c[ku + 2],
                            c[ku + 3],
                            noise::channel_seed(seed, ch as u32),
                        );
                    }
                    v[d] = o;
                }
                op::GRAD => f[d] = gradient(k, v[a]),
                op::CHECK => {
                    let s = f[b];
                    let p = v[a];
                    let sum = ((p[0] * s).floor() + (p[1] * s).floor()) + (p[2] * s).floor();
                    f[d] = sum - 2.0 * (sum * 0.5).floor();
                }
                op::STRIPE => f[d] = stripe(&c[ku..ku + 2], v[a], f[b], f[cr]),
                op::RAMP => v[d] = ramp(&c[ku..], clamp01(f[a])),
                op::FRESNEL => f[d] = fresnel(f[a], dot(v[cr], v[b])),
                op::FACING => {
                    let fc = 1.0 - clamp01(dot(v[cr], v[b]).abs());
                    let m = f[a];
                    // `m < 0.001 ? 0.001 : m > 0.999 ? 0.999 : m` (a NaN goes through).
                    let bl = m.clamp(0.001, 0.999);
                    f[d] = if fc > 0.0 {
                        fmath::powf(fc, (1.0 - bl) / bl)
                    } else {
                        0.0
                    };
                }
                op::EDGE => f[d] = host.edge(c[ku]),
                op::CAVITY => f[d] = host.cavity(c[ku]),
                op::NMAP => v[d] = normal_map(k, v[a], f[b], v[cr], v[5]),
                op::BUMP => {
                    let n0 = v[a];
                    let (t, bb) = frame_around(n0, v[5]);
                    let (dt, db) = (f[b], f[cr]);
                    v[d] = normalize_or(
                        [
                            n0[0] - ((t[0] * dt) + (bb[0] * db)),
                            n0[1] - ((t[1] * dt) + (bb[1] * db)),
                            n0[2] - ((t[2] * dt) + (bb[2] * db)),
                        ],
                        n0,
                    );
                }
                op::WOOD
                | op::WOODR
                | op::WOODH
                | op::WOODN
                | op::CLOTH
                | op::CLOTHR
                | op::CLOTHH
                | op::CLOTHN => {
                    let (p, n) = (v[a], v[b]);
                    let sampled = match &self.recipes[at] {
                        Some(recipe) => {
                            let kind = super::pattern_kind(code).unwrap_or(0);
                            let key = [p[0], p[1], p[2], n[0], n[1], n[2]].map(f32::to_bits);
                            match last {
                                Some((lk, lkind, lkey, s))
                                    if lk == k && lkind == kind && lkey == key =>
                                {
                                    Some(s)
                                }
                                _ => {
                                    let at = host.placement(k, kind).unwrap_or(&IDENTITY);
                                    let (pp, nn) =
                                        (Vec3::new(p[0], p[1], p[2]), Vec3::new(n[0], n[1], n[2]));
                                    let s = sample_at(recipe, at, pp, nn, nn);
                                    if let Some(t) = s.tint.tangent {
                                        host.grain(t);
                                    }
                                    last = Some((k, kind, key, s));
                                    Some(s)
                                }
                            }
                        }
                        None => None,
                    };
                    match code {
                        op::WOOD | op::CLOTH => {
                            v[d] = sampled.map_or([0.0; 3], |s| {
                                let c = s.tint.base_color;
                                [c.r, c.g, c.b]
                            });
                        }
                        op::WOODR | op::CLOTHR => {
                            // The material's roughness times the pattern's, plus its own (a
                            // knot's end grain): `Tint::apply` before its clamp.
                            f[d] = sampled.map_or(f[cr], |s| {
                                (f[cr] * s.tint.roughness) + s.tint.roughness_add
                            });
                        }
                        op::WOODH | op::CLOTHH => f[d] = sampled.map_or(0.0, |s| s.height),
                        _ => {
                            v[d] = match sampled.and_then(|s| s.slope) {
                                Some(g) => {
                                    let bent = crate::pattern::bump(Vec3::new(n[0], n[1], n[2]), g);
                                    [bent.x, bent.y, bent.z]
                                }
                                None => n,
                            };
                        }
                    }
                }
                _ => unreachable!("a checked program has only known opcodes"),
            }
        }
        for (slot, o) in out.iter_mut().zip(&self.program.outputs) {
            *slot = read(o, &f, &v, c);
        }
    }
}

/// The value `o` refers to after a run.
#[inline]
fn read(o: &ValueRef, f: &[f32; MAX_F], v: &[[f32; 3]; MAX_V], c: &[f32]) -> [f32; 3] {
    match *o {
        ValueRef::FConst(k) => [c[k as usize], 0.0, 0.0],
        ValueRef::F(r) => [f[r as usize], 0.0, 0.0],
        ValueRef::VConst(k) => {
            let k = k as usize;
            [c[k], c[k + 1], c[k + 2]]
        }
        ValueRef::V(r) => v[r as usize],
    }
}

/// Number of the shading point's registers (for the tests).
pub const CONTEXT_REGISTERS: usize = CTX_COUNT;

/// `x < 0 ? 0 : x > 1 ? 1 : x` (a NaN goes through).
#[inline]
pub fn clamp01(x: f32) -> f32 {
    // `f32::clamp` is exactly these comparisons (and keeps −0 and NaN).
    x.clamp(0.0, 1.0)
}

/// `a + t·(b − a)`.
#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + t * (b - a)
}

#[inline]
fn per(a: [f32; 3], b: [f32; 3], g: impl Fn(f32, f32) -> f32) -> [f32; 3] {
    [g(a[0], b[0]), g(a[1], b[1]), g(a[2], b[2])]
}

/// `((a.x·b.x) + (a.y·b.y)) + (a.z·b.z)`.
#[inline]
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] * b[0]) + (a[1] * b[1])) + (a[2] * b[2])
}

/// `x / |x|`, or `fallback` when `|x|` is not above 0.
#[inline]
fn normalize_or(x: [f32; 3], fallback: [f32; 3]) -> [f32; 3] {
    let l = dot(x, x).sqrt();
    if l.is_nan() || l <= 0.0 {
        return fallback;
    }
    [x[0] / l, x[1] / l, x[2] / l]
}

/// `smoothstep(e0, e1, x)`: a step at `e0` when the edges are neither above nor below each other.
#[inline]
pub fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    // Neither above nor below: equal, or a NaN.
    if e1 == e0 || e1.is_nan() || e0.is_nan() {
        return if x < e0 { 0.0 } else { 1.0 };
    }
    let t = clamp01((x - e0) / (e1 - e0));
    (t * t) * (3.0 - 2.0 * t)
}

/// The power of the Maths node.
#[inline]
pub fn pow_op(x: f32, y: f32) -> f32 {
    if x > 0.0 {
        return fmath::powf(x, y);
    }
    if x == 0.0 {
        return if y == 0.0 { 1.0 } else { 0.0 };
    }
    if x < 0.0 && y == y.floor() && y.abs() <= 16_777_216.0 {
        let r = fmath::powf(-x, y);
        return if y % 2.0 != 0.0 { -r } else { r };
    }
    if x.is_nan() {
        x
    } else {
        0.0
    }
}

/// Polynomial smooth minimum with blend distance `k` (`k ≤ 0` or NaN: the minimum).
#[inline]
pub fn smooth_min(x: f32, y: f32, k: f32) -> f32 {
    let m = if y < x { y } else { x };
    if k.is_nan() || k <= 0.0 {
        return m;
    }
    let h0 = k - (x - y).abs();
    let h = (if h0 > 0.0 { h0 } else { 0.0 }) / k;
    m - ((h * h) * k) * 0.25
}

/// The `BLEND` of `x` and `y` by mode `mode` and `t` (already clamped).
#[inline]
fn blend(mode: u32, a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    per(a, b, |x, y| {
        let r = match mode {
            1 => x + y,
            2 => x * y,
            3 => x - y,
            4 => 1.0 - ((1.0 - x) * (1.0 - y)),
            5 => (x - y).abs(),
            6 => {
                if y > x {
                    y
                } else {
                    x
                }
            }
            7 => {
                if y < x {
                    y
                } else {
                    x
                }
            }
            8 => {
                if x < 0.5 {
                    (2.0 * x) * y
                } else {
                    1.0 - ((2.0 * (1.0 - x)) * (1.0 - y))
                }
            }
            _ => y,
        };
        lerp(x, r, t)
    })
}

/// Turns about an axis, −0.5..0.5, 0 facing −T of the cross-section.
#[inline]
fn turns(s: f32, t: f32) -> f32 {
    let c = (fmath::atan2(t, s) + fmath::FRAC_PI_2) / fmath::TAU;
    c - (c + 0.5).floor()
}

/// The coordinates of a projection before its turn, repeat and offset, `(cu, cv, w)`, and its
/// centre: the constants `m` (projection, axis, size, cos, sin, repeat u, v, offset u, v).
#[inline]
fn map_coords(m: &[f32], p: [f32; 3], n: [f32; 3], uv: [f32; 3]) -> (f32, f32, f32, f32) {
    let (proj, axis, size) = (m[0], m[1], m[2]);
    let [px, py, pz] = p;
    // The cross-section axes (S, T, A) of the axis: Z (x, y, z), X (y, z, x), Y (z, x, y).
    let s_ = if axis == 2.0 {
        px
    } else if axis == 0.0 {
        py
    } else {
        pz
    };
    let t_ = if axis == 2.0 {
        py
    } else if axis == 0.0 {
        pz
    } else {
        px
    };
    let a_ = if axis == 2.0 {
        pz
    } else if axis == 0.0 {
        px
    } else {
        py
    };
    if proj == 0.0 {
        (uv[0], uv[1], 0.0, 0.0)
    } else if proj == 1.0 {
        // Planar: Z from above (x, y), Y from the front (x, z), X from +X (y, z).
        let s = if axis == 2.0 || axis == 1.0 { px } else { py };
        let t = if axis == 2.0 { py } else { pz };
        (s / size, t / size, 0.0, 0.5)
    } else if proj == 2.0 {
        // Box: the face the normal is closest to, seen from outside, never mirrored.
        let (ax, ay, az) = (n[0].abs(), n[1].abs(), n[2].abs());
        let (s, t) = if ax >= ay && ax >= az {
            (if n[0] >= 0.0 { py } else { -py }, pz)
        } else if ay >= az {
            (if n[1] <= 0.0 { px } else { -px }, pz)
        } else {
            (if n[2] >= 0.0 { px } else { -px }, py)
        };
        (s / size, t / size, 0.0, 0.5)
    } else if proj == 3.0 {
        (turns(s_, t_), a_ / size, 0.0, 0.5)
    } else if proj == 4.0 {
        let r = dot(p, p).sqrt();
        let cv = if r > 0.0 {
            fmath::asin(a_ / r) / fmath::PI
        } else {
            0.0
        };
        (turns(s_, t_), cv, 0.0, 0.5)
    } else {
        // Object: the part's own coordinates over the size.
        (s_ / size, t_ / size, a_ / size, 0.0)
    }
}

/// `MAP`: the coordinates of a projection (ARCHITECTURE §5.2 quater, `MAP`).
#[inline]
fn map(m: &[f32], p: [f32; 3], n: [f32; 3], uv: [f32; 3]) -> [f32; 3] {
    let (cu, cv, w, centre) = map_coords(m, p, n, uv);
    let (cos, sin, ru, rv, ou, ov) = (m[3], m[4], m[5], m[6], m[7], m[8]);
    let x = cu * ru;
    let y = cv * rv;
    [
        (((cos * x) - (sin * y)) + ou) + centre,
        (((sin * x) + (cos * y)) + ov) + centre,
        w,
    ]
}

/// The change of a `MAP`'s `(u, v)` across the footprint's two axes: the projection at the point
/// moved along each (and its UV set moved by its change there), the turn of a cylinder or a
/// sphere taken across its seam.
fn map_change(
    m: &[f32],
    p: [f32; 3],
    n: [f32; 3],
    uv: [f32; 3],
    fp: &Footprint,
    set: Option<u8>,
) -> ((f32, f32), (f32, f32)) {
    let (cu, cv, _, _) = map_coords(m, p, n, uv);
    let round = m[0] == 3.0 || m[0] == 4.0;
    let (cos, sin, ru, rv) = (m[3], m[4], m[5], m[6]);
    let along = |axis: usize, d: [f32; 3]| -> (f32, f32) {
        let duv = set.map_or([0.0, 0.0], |s| fp.duv[s as usize][axis]);
        let q = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        let w = [uv[0] + duv[0], uv[1] + duv[1], uv[2]];
        let (u2, v2, _, _) = map_coords(m, q, n, w);
        let mut du = u2 - cu;
        if round {
            du -= (du + 0.5).floor();
        }
        let dv = v2 - cv;
        let x = du * ru;
        let y = dv * rv;
        ((cos * x) - (sin * y), (sin * x) + (cos * y))
    };
    (along(0, fp.dx), along(1, fp.dy))
}

/// `GRAD`: the gradient of kind `kind`, clamped to 0..1.
#[inline]
fn gradient(kind: u32, p: [f32; 3]) -> f32 {
    let [x, y, _] = p;
    let g = match kind {
        1 => {
            if x > 0.0 {
                x * x
            } else {
                0.0
            }
        }
        2 => {
            let t = clamp01(x);
            (t * t) * (3.0 - 2.0 * t)
        }
        3 => (x + y) * 0.5,
        4 => 1.0 - dot(p, p).sqrt(),
        5 => (fmath::atan2(y, x) / fmath::TAU) + 0.5,
        _ => x,
    };
    clamp01(g)
}

/// `STRIPE`: bands across an axis (`m`: axis, softness).
#[inline]
fn stripe(m: &[f32], p: [f32; 3], scale: f32, width: f32) -> f32 {
    let axis = m[0];
    let q = p[if axis == 1.0 {
        1
    } else if axis == 2.0 {
        2
    } else {
        0
    }] * scale;
    let t = q - q.floor();
    let w = clamp01(width);
    let half = w * 0.5;
    let away = (t - half).abs();
    let other = 1.0 - away;
    let dist = if other < away { other } else { away };
    let narrow = if 1.0 - w < w { 1.0 - w } else { w };
    let e = (clamp01(m[1]) * 0.5) * narrow;
    1.0 - smoothstep(half - e, half + e, dist)
}

/// `RAMP`: `m` from the instruction's constant: count, interpolation, then (position, r, g, b)
/// per stop, sorted.
#[inline]
fn ramp(m: &[f32], x: f32) -> [f32; 3] {
    let n = m[0];
    let interp = m[1];
    let first = 2usize;
    let stop = |i: usize| -> usize { first + i * 4 };
    let count = n as usize;
    let mut i = 0usize;
    let copy = if n <= 1.0 || x <= m[first] {
        Some(0)
    } else if x >= m[stop(count - 1)] {
        Some(count - 1)
    } else {
        // Not below the next stop (a NaN is not below anything).
        while (i as f32) < n - 2.0 && (x.is_nan() || x >= m[stop(i + 1)]) {
            i += 1;
        }
        (interp == 2.0).then_some(i)
    };
    if let Some(j) = copy {
        let o = stop(j);
        return [m[o + 1], m[o + 2], m[o + 3]];
    }
    let o0 = stop(i);
    let o1 = o0 + 4;
    let mut t = (x - m[o0]) / (m[o1] - m[o0]);
    if interp == 1.0 {
        t = (t * t) * (3.0 - 2.0 * t);
    }
    [
        lerp(m[o0 + 1], m[o1 + 1], t),
        lerp(m[o0 + 2], m[o1 + 2], t),
        lerp(m[o0 + 3], m[o1 + 3], t),
    ]
}

/// The exact dielectric Fresnel reflectance, unpolarised, for relative index `ior` and the cosine
/// between the view and the normal; 0 for `ior ≤ 1` (or NaN).
#[inline]
pub fn fresnel(ior: f32, cosv: f32) -> f32 {
    if ior.is_nan() || ior <= 1.0 {
        return 0.0;
    }
    let c = clamp01(cosv.abs());
    let g = (((ior * ior) - 1.0) + (c * c)).sqrt();
    let a = (g - c) / (g + c);
    let b = ((c * (g + c)) - 1.0) / ((c * (g - c)) + 1.0);
    clamp01((0.5 * (a * a)) * (1.0 + (b * b)))
}

/// The tangent of `onb(n)` (Frisvad's construction as revised by Duff et al., "Building an
/// orthonormal basis, revisited", JCGT 2017): `s = n.z < 0 ? −1 : 1`, `a = −1/(s + n.z)`,
/// `b = (n.x·n.y)·a`, `T = (1 + ((s·n.x)·n.x)·a, s·b, −(s·n.x))`.
#[inline]
pub fn onb_tangent(n: [f32; 3]) -> [f32; 3] {
    let [nx, ny, nz] = n;
    let s = if nz < 0.0 { -1.0f32 } else { 1.0 };
    let a = -1.0 / (s + nz);
    let b = (nx * ny) * a;
    [1.0 + ((s * nx) * nx) * a, s * b, -(s * nx)]
}

/// The tangent frame around `n`: `t` orthogonalised against it (the onb tangent when they are
/// parallel), and `n × T`.
#[inline]
fn frame_around(n: [f32; 3], t: [f32; 3]) -> ([f32; 3], [f32; 3]) {
    let k = dot(t, n);
    let mut tt = [t[0] - k * n[0], t[1] - k * n[1], t[2] - k * n[2]];
    let l = dot(tt, tt).sqrt();
    if l > 1.0e-6 {
        tt = [tt[0] / l, tt[1] / l, tt[2] / l];
    } else {
        tt = onb_tangent(n);
    }
    let b = [
        (n[1] * tt[2]) - (n[2] * tt[1]),
        (n[2] * tt[0]) - (n[0] * tt[2]),
        (n[0] * tt[1]) - (n[1] * tt[0]),
    ];
    (tt, b)
}

/// `NMAP`: a normal map's colour `color` at strength `s` around `n0`, in tangent space (0, the
/// frame of `t`) or in the part's space (1). No normal points into the surface (C1): in tangent
/// space a blue below 0.5 has its `2b - 1` mirrored, and in the part's space a result past the
/// surface is mirrored across its plane.
#[inline]
fn normal_map(space: u32, color: [f32; 3], s: f32, n0: [f32; 3], t: [f32; 3]) -> [f32; 3] {
    let mut m = color.map(|x| (2.0 * x) - 1.0);
    if space == 1 {
        let tt = normalize_or(m, n0);
        let r = normalize_or(
            [
                n0[0] + s * (tt[0] - n0[0]),
                n0[1] + s * (tt[1] - n0[1]),
                n0[2] + s * (tt[2] - n0[2]),
            ],
            n0,
        );
        // C1: past the surface (a map against it, at a strength over 0.5), the normal is mirrored
        // across the surface's plane to the outer side.
        let k = dot(r, n0);
        if k < 0.0 {
            let t = 2.0 * k;
            normalize_or([r[0] - t * n0[0], r[1] - t * n0[1], r[2] - t * n0[2]], n0)
        } else {
            r
        }
    } else {
        m[2] = m[2].abs();
        let (ft, fb) = frame_around(n0, t);
        let (sx, sy) = (m[0] * s, m[1] * s);
        normalize_or(
            [
                ((ft[0] * sx) + (fb[0] * sy)) + (n0[0] * m[2]),
                ((ft[1] * sx) + (fb[1] * sy)) + (n0[1] * m[2]),
                ((ft[2] * sx) + (fb[2] * sy)) + (n0[2] * m[2]),
            ],
            n0,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tangent_space_normal_map_never_points_into_the_surface() {
        // C1: a blue below 0.5 is mirrored to the outer side; the same map with the blue mirrored
        // about 0.5 bends the normal the same way.
        let n0 = [0.0, 0.0, 1.0];
        let t = [1.0, 0.0, 0.0];
        for (r, g, b) in [
            (0.5, 0.5, 0.0),
            (1.0, 0.5, 0.2),
            (0.1, 0.9, 0.45),
            (0.73, 0.21, 0.0),
        ] {
            for s in [0.35, 1.0, 4.0] {
                let n = normal_map(0, [r, g, b], s, n0, t);
                assert!(dot(n, n0) >= 0.0, "{r} {g} {b} at {s}: {n:?}");
                let up = normal_map(0, [r, g, 1.0 - b], s, n0, t);
                for i in 0..3 {
                    assert!((n[i] - up[i]).abs() < 1.0e-6, "{n:?} {up:?}");
                }
            }
        }
        // Blue 0 with no tilt is the surface's own normal, not its opposite.
        assert_eq!(normal_map(0, [0.5, 0.5, 0.0], 1.0, n0, t), n0);
        // A blue above 0.5 is as before.
        let n = normal_map(0, [1.0, 0.5, 0.5], 1.0, n0, t);
        assert!((n[0] - 1.0).abs() < 1.0e-6, "{n:?}");
    }

    #[test]
    fn a_part_space_normal_map_never_points_into_the_surface() {
        // C1: a map against the surface at a strength over 0.5 is mirrored across its plane; under
        // 0.5 (or with the map on the outer side) it is as before.
        let n0 = [0.0, 0.0, 1.0];
        let t = [1.0, 0.0, 0.0];
        let against = [0.6, 0.5, 0.0]; // (0.2, 0, -1) in the part's space
        for s in [0.6, 1.0, 3.0, 10.0] {
            let n = normal_map(1, against, s, n0, t);
            assert!(dot(n, n0) >= 0.0, "at {s}: {n:?}");
            assert!((dot(n, n) - 1.0).abs() < 1.0e-5);
        }
        // Straight into the surface at full strength: the surface's plane is all there is, and
        // mirrored the normal is the surface's own.
        let n = normal_map(1, [0.5, 0.5, 0.0], 1.0, n0, t);
        assert!(dot(n, n0) >= 0.0, "{n:?}");
        // At 0.5 or under, nothing changes.
        let n = normal_map(1, against, 0.4, n0, t);
        assert!(dot(n, n0) > 0.0);
        let tilted = normal_map(1, [1.0, 0.5, 0.5], 1.0, n0, t);
        assert!((tilted[0] - 1.0).abs() < 1.0e-6, "{tilted:?}");
    }
}

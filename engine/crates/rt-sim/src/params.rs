//! The parameters of one ambient effect and their binary form, the payload of the RSB `FXAM`
//! section (one section per effect; a reader that does not know the tag skips it).
//!
//! Everything is little-endian, four bytes per field; units are the scene's (millimetres,
//! seconds, so speeds in mm/s), angles do not appear (the writer turns the wind's direction into
//! its vector). The first 128 bytes are the fields of the roadmap's brief, in its order; the rest
//! were added by the implementation and read as their defaults when a shorter payload ends
//! before them. A payload may be longer (a newer writer appends fields): the extra bytes are
//! ignored. The budget is 256 bytes per effect.
//!
//! ```text
//! off  type      field                  meaning
//!   0  u32       kind                   preset code (1 DUST_MOTES, 2 POLLEN, 3 RAIN, 4 SNOW,
//!                                       5 DUST_CLOUD, 6 ASH, 7 BUBBLES, 8 CONFETTI; others are
//!                                       kept and evaluated like any effect: the fields decide)
//!   4  u32       seed
//!   8  f32       time                   the instant the effect is frozen at, s
//!  12  u32       count                  particles to evaluate (the writer applies the cap)
//!  16  f32[3]    region_centre          mm
//!  28  f32[3]    region_half            half size of the region box, mm (>= 0)
//!  40  f32[2]    band                   z range kept of the region, mm (min >= max: no band)
//!  48  f32       size_mm                mean diameter, mm (>= 0)
//!  52  f32       size_var               relative variation, 0..1
//!  56  u32       shape                  0 sphere, 1 disc (flake), 2 capsule (streak)
//!  60  f32       fall_speed             terminal fall speed at 1 g, mm/s (>= 0)
//!  64  f32       fall_var               relative variation, 0..1
//!  68  f32[3]    wind                   mm/s
//!  80  f32[3]    turbulence             strength (displacement, mm), scale (mm), speed (mm/s)
//!  92  f32[3]    cloud_centre           mm
//! 104  f32       cloud_radius           mm; 0: no cloud envelope (the region box is filled)
//! 108  f32       cloud_softness         0 hard edge .. 1 soft
//! 112  u32       material_id            index of a MATL section
//! 116  f32       tint_var               per-particle tint variation, 0..1
//! 120  u32       flags                  1 seen by camera rays, 2 in reflections, 4 casts shadow
//! 124  f32       streak                 capsule length over speed, s
//! ---- 128 B: optional from here
//! 128  f32       gravity                multiple of g (1); negative rises
//! 132  f32       energy                 initial speed, mm/s (0)
//! 136  f32       spin                   turns per second of discs (0)
//! 140  u32       palette_count          tints to choose from, 0..=4 (0)
//! 144  f32[4][3] palette                linear RGB, multiplies the material's base colour
//! ---- 192 B (S4a)
//! 192  f32       forward                share of the forward lobe of the particles' material,
//!                                       0..1 (0: none; S4b)
//! 196  f32       forward_g              its Henyey–Greenstein asymmetry, -1 < g < 1 (0)
//! ---- 200 B (S4b)
//! 200  f32[4]    mix                    weights of a mix of shapes: sphere, disc, capsule, drop
//!                                       (>= 0; all 0: every particle is `shape`; S3)
//! 216  f32       drop_tail              a drop's length: from the centre of its round body to the
//!                                       centre of its tip, over the body's radius, 0..16 (1.6)
//! 220  f32       drop_tip               the radius of a drop's tip over its body's, 0..1 (0.15)
//! 224  f32       shape_var              per-particle variation of a drop's length and of a
//!                                       capsule's, 0..1 (0)
//! ---- 228 B (S3)
//! ```
//!
//! The writer adds the S3 fields only when one of them is not its default ([`AmbientParams::has_s3_fields`]),
//! so an effect without drops, mixes or shape variation keeps the 200 bytes of S4b.

use std::fmt;

/// Bytes a payload must have: the fields of the brief.
pub const FXAM_MIN_BYTES: usize = 128;
/// Bytes this version writes for an effect without the S3 fields (the payload of S4b).
pub const FXAM_BYTES: usize = 200;
/// Bytes this version writes for an effect with a drop, a mix of shapes or a shape variation (S3).
pub const FXAM_S3_BYTES: usize = 228;
/// Default `drop_tail`: the centre of a drop's tip 1.6 body radii from its body's (S3; a proposal
/// for the lead's verdict, rule 11).
pub const DROP_TAIL: f32 = 1.6;
/// Default `drop_tip`: a drop's tip 0.15 times as wide as its body (S3; a proposal, rule 11).
pub const DROP_TIP: f32 = 0.15;
/// Largest `drop_tail`.
pub const MAX_DROP_TAIL: f32 = 16.0;
/// Shapes of a mix ([`AmbientParams::mix`]), in the order of [`Shape::to_u32`].
pub const MIX_SHAPES: [Shape; 4] = [Shape::Sphere, Shape::Disc, Shape::Capsule, Shape::Drop];
/// Largest `count` accepted (16 777 216): a hostile file cannot ask for more memory than that.
pub const MAX_COUNT: u32 = 1 << 24;
/// Most tints of a palette.
pub const MAX_PALETTE: usize = 4;

/// `flags` bit: camera rays see the particles.
pub const FLAG_CAMERA: u32 = 1;
/// `flags` bit: reflected, refracted and diffuse rays see the particles.
pub const FLAG_REFLECTIONS: u32 = 2;
/// `flags` bit: the particles cast shadows (block shadow rays).
pub const FLAG_SHADOW: u32 = 4;

/// The geometric shape of every particle of an effect.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Shape {
    /// 0: a sphere of the particle's radius (dust, pollen, droplets, bubbles).
    #[default]
    Sphere,
    /// 1: a flat disc of the particle's radius around its normal (snowflakes, confetti, ash).
    Disc,
    /// 2: a capsule, the sphere swept along the particle's velocity times `streak` (rain).
    Capsule,
    /// 3 (S3): a drop, the convex hull of its round body (the particle's radius) and of a smaller
    /// tip sphere (`drop_tip` times as wide) whose centre is `drop_tail` body radii away, behind the
    /// body as the particle moves (a falling drop has its tip up).
    Drop,
}

impl Shape {
    /// Decodes the `FXAM` value: 1 disc, 2 capsule, 3 drop (S3), anything else (0, and values a
    /// newer writer may add) a sphere. An engine of before S3 reads a drop as a sphere.
    pub fn from_u32(value: u32) -> Shape {
        match value {
            1 => Shape::Disc,
            2 => Shape::Capsule,
            3 => Shape::Drop,
            _ => Shape::Sphere,
        }
    }

    /// The `FXAM` value of this shape.
    pub fn to_u32(self) -> u32 {
        match self {
            Shape::Sphere => 0,
            Shape::Disc => 1,
            Shape::Capsule => 2,
            Shape::Drop => 3,
        }
    }
}

/// Why an `FXAM` payload could not be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FxamError {
    /// The payload is shorter than [`FXAM_MIN_BYTES`].
    TooShort,
    /// A field holds a value that is not allowed (the text says which).
    Invalid(&'static str),
}

impl FxamError {
    /// A short description, for error messages.
    pub fn reason(self) -> &'static str {
        match self {
            FxamError::TooShort => "payload shorter than 128 bytes",
            FxamError::Invalid(reason) => reason,
        }
    }
}

impl fmt::Display for FxamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.reason())
    }
}

impl std::error::Error for FxamError {}

/// The parameters of one ambient effect: the `FXAM` fields (see the [module](self) table).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AmbientParams {
    /// Preset code (informative: the fields decide what is evaluated).
    pub kind: u32,
    /// Seed of every random choice.
    pub seed: u32,
    /// The instant the effect is frozen at, seconds.
    pub time: f32,
    /// Number of particles.
    pub count: u32,
    /// Centre of the region box, mm.
    pub region_centre: [f32; 3],
    /// Half size of the region box, mm.
    pub region_half: [f32; 3],
    /// `[min, max]` heights kept of the region, mm; `min >= max`: the whole box.
    pub band: [f32; 2],
    /// Mean diameter, mm.
    pub size_mm: f32,
    /// Relative size variation, 0..1.
    pub size_var: f32,
    /// Shape of every particle.
    pub shape: Shape,
    /// Terminal fall speed at 1 g, mm/s.
    pub fall_speed: f32,
    /// Relative variation of the fall speed, 0..1.
    pub fall_var: f32,
    /// Wind velocity, mm/s.
    pub wind: [f32; 3],
    /// Turbulence: displacement strength (mm), length scale (mm) and speed of change (mm/s).
    pub turbulence: [f32; 3],
    /// Centre of the cloud envelope, mm.
    pub cloud_centre: [f32; 3],
    /// Radius of the cloud envelope, mm; 0: no envelope.
    pub cloud_radius: f32,
    /// Softness of the cloud's edge, 0..1.
    pub cloud_softness: f32,
    /// Index of the material (`MATL` section).
    pub material_id: u32,
    /// Per-particle tint variation, 0..1.
    pub tint_var: f32,
    /// Bit set of `FLAG_*`.
    pub flags: u32,
    /// Capsule length over speed, seconds (a shutter time).
    pub streak: f32,
    /// Gravity as a multiple of g; negative rises (buoyancy).
    pub gravity: f32,
    /// Speed of a particle when it is born, mm/s, in a random direction.
    pub energy: f32,
    /// Turns per second of a disc about a random axis.
    pub spin: f32,
    /// Number of tints in `palette` (0..=[`MAX_PALETTE`]).
    pub palette_count: u32,
    /// Tints a particle picks one of (linear RGB multipliers of the base colour).
    pub palette: [[f32; 3]; MAX_PALETTE],
    /// Share of what a particle scatters that goes into a forward lobe (Henyey–Greenstein), 0..1
    /// (S4b; 0: none).
    pub forward: f32,
    /// Asymmetry of that lobe, `-1 < g < 1`.
    pub forward_g: f32,
    /// S3: the weights of a mix of shapes, in the order of [`MIX_SHAPES`] (sphere, disc, capsule,
    /// drop); each particle picks one with a probability proportional to its weight. All zero:
    /// every particle is `shape`.
    pub mix: [f32; 4],
    /// S3: a drop's length, from its body's centre to its tip's, over the body's radius.
    pub drop_tail: f32,
    /// S3: a drop's tip radius over its body's.
    pub drop_tip: f32,
    /// S3: the per-particle variation of a drop's length and of a capsule's, 0..1.
    pub shape_var: f32,
}

impl Default for AmbientParams {
    /// No particles; the other fields as a file that ends after the brief's fields reads them.
    fn default() -> AmbientParams {
        AmbientParams {
            kind: 0,
            seed: 0,
            time: 0.0,
            count: 0,
            region_centre: [0.0; 3],
            region_half: [0.0; 3],
            band: [0.0; 2],
            size_mm: 0.0,
            size_var: 0.0,
            shape: Shape::Sphere,
            fall_speed: 0.0,
            fall_var: 0.0,
            wind: [0.0; 3],
            turbulence: [0.0; 3],
            cloud_centre: [0.0; 3],
            cloud_radius: 0.0,
            cloud_softness: 0.0,
            material_id: 0,
            tint_var: 0.0,
            flags: FLAG_CAMERA | FLAG_REFLECTIONS | FLAG_SHADOW,
            streak: 0.0,
            gravity: 1.0,
            energy: 0.0,
            spin: 0.0,
            palette_count: 0,
            palette: [[1.0; 3]; MAX_PALETTE],
            forward: 0.0,
            forward_g: 0.0,
            mix: [0.0; 4],
            drop_tail: DROP_TAIL,
            drop_tip: DROP_TIP,
            shape_var: 0.0,
        }
    }
}

/// Cursor over a payload.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn has(&self, bytes: usize) -> bool {
        self.data.len() >= self.pos + bytes
    }

    fn word(&mut self) -> [u8; 4] {
        let w = [
            self.data[self.pos],
            self.data[self.pos + 1],
            self.data[self.pos + 2],
            self.data[self.pos + 3],
        ];
        self.pos += 4;
        w
    }

    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.word())
    }

    fn f32(&mut self) -> Result<f32, FxamError> {
        let v = f32::from_le_bytes(self.word());
        if v.is_finite() {
            Ok(v)
        } else {
            Err(FxamError::Invalid("non-finite number"))
        }
    }

    fn vec3(&mut self) -> Result<[f32; 3], FxamError> {
        Ok([self.f32()?, self.f32()?, self.f32()?])
    }

    fn opt_u32(&mut self, default: u32) -> u32 {
        if self.has(4) {
            self.u32()
        } else {
            default
        }
    }

    fn opt_f32(&mut self, default: f32) -> Result<f32, FxamError> {
        if self.has(4) {
            self.f32()
        } else {
            Ok(default)
        }
    }
}

impl AmbientParams {
    /// Reads an `FXAM` payload. Fails when it is shorter than [`FXAM_MIN_BYTES`], holds a
    /// non-finite number, a negative size, radius or scale, more than [`MAX_COUNT`] particles,
    /// more than [`MAX_PALETTE`] tints, a forward lobe outside its ranges, a negative weight of
    /// the mix, or a drop or a shape variation outside theirs.
    pub fn decode(payload: &[u8]) -> Result<AmbientParams, FxamError> {
        if payload.len() < FXAM_MIN_BYTES {
            return Err(FxamError::TooShort);
        }
        let mut r = Reader {
            data: payload,
            pos: 0,
        };
        let d = AmbientParams::default();
        let mut p = AmbientParams {
            kind: r.u32(),
            seed: r.u32(),
            time: r.f32()?,
            count: r.u32(),
            region_centre: r.vec3()?,
            region_half: r.vec3()?,
            band: [r.f32()?, r.f32()?],
            size_mm: r.f32()?,
            size_var: r.f32()?,
            shape: Shape::from_u32(r.u32()),
            fall_speed: r.f32()?,
            fall_var: r.f32()?,
            wind: r.vec3()?,
            turbulence: r.vec3()?,
            cloud_centre: r.vec3()?,
            cloud_radius: r.f32()?,
            cloud_softness: r.f32()?,
            material_id: r.u32(),
            tint_var: r.f32()?,
            flags: r.u32(),
            streak: r.f32()?,
            gravity: r.opt_f32(d.gravity)?,
            energy: r.opt_f32(d.energy)?,
            spin: r.opt_f32(d.spin)?,
            palette_count: r.opt_u32(d.palette_count),
            palette: d.palette,
            forward: d.forward,
            forward_g: d.forward_g,
            mix: d.mix,
            drop_tail: d.drop_tail,
            drop_tip: d.drop_tip,
            shape_var: d.shape_var,
        };
        if p.palette_count as usize > MAX_PALETTE {
            return Err(FxamError::Invalid("palette_count must be at most 4"));
        }
        for tint in p.palette.iter_mut() {
            if r.has(12) {
                *tint = r.vec3()?;
            }
        }
        p.forward = r.opt_f32(d.forward)?;
        p.forward_g = r.opt_f32(d.forward_g)?;
        if !(0.0..=1.0).contains(&p.forward) {
            return Err(FxamError::Invalid("forward must be within 0..1"));
        }
        if !(p.forward_g > -1.0 && p.forward_g < 1.0) {
            return Err(FxamError::Invalid("forward_g must be within -1..1"));
        }
        for w in p.mix.iter_mut() {
            *w = r.opt_f32(0.0)?;
        }
        p.drop_tail = r.opt_f32(d.drop_tail)?;
        p.drop_tip = r.opt_f32(d.drop_tip)?;
        p.shape_var = r.opt_f32(d.shape_var)?;
        if p.mix.iter().any(|&w| w < 0.0) {
            return Err(FxamError::Invalid(
                "the weights of a mix must not be negative",
            ));
        }
        if !(0.0..=MAX_DROP_TAIL).contains(&p.drop_tail) {
            return Err(FxamError::Invalid("drop_tail must be within 0..16"));
        }
        if !(0.0..=1.0).contains(&p.drop_tip) {
            return Err(FxamError::Invalid("drop_tip must be within 0..1"));
        }
        if !(0.0..=1.0).contains(&p.shape_var) {
            return Err(FxamError::Invalid("shape_var must be within 0..1"));
        }
        if p.count > MAX_COUNT {
            return Err(FxamError::Invalid("count must be at most 16777216"));
        }
        let non_negative = [
            p.region_half[0],
            p.region_half[1],
            p.region_half[2],
            p.size_mm,
            p.fall_speed,
            p.turbulence[0],
            p.turbulence[1],
            p.cloud_radius,
            p.streak,
            p.energy,
        ];
        if non_negative.iter().any(|&v| v < 0.0) {
            return Err(FxamError::Invalid(
                "sizes, speeds, scales and radii must not be negative",
            ));
        }
        Ok(p)
    }

    /// True when an S3 field is not its default: a drop as the shape, a mix, a shape variation,
    /// or another drop than the default one. Only then does [`AmbientParams::encode`] write them.
    pub fn has_s3_fields(&self) -> bool {
        self.shape == Shape::Drop
            || self.mix.iter().any(|&w| w != 0.0)
            || self.shape_var != 0.0
            || self.drop_tail != DROP_TAIL
            || self.drop_tip != DROP_TIP
    }

    /// True when the particles mix shapes: some weight of [`AmbientParams::mix`] is above zero.
    pub fn mixed(&self) -> bool {
        self.mix.iter().any(|&w| w > 0.0)
    }

    /// The shape a particle whose uniform draw is `u` (in `[0, 1)`) takes: `shape` without a mix;
    /// with one, the shape whose share of the weights' running sum `u` falls in.
    pub fn shape_for(&self, u: f32) -> Shape {
        if !self.mixed() {
            return self.shape;
        }
        let total: f32 = self.mix.iter().sum();
        let mut acc = 0.0f32;
        let target = u * total;
        let mut last = self.shape;
        for (shape, &w) in MIX_SHAPES.iter().zip(&self.mix) {
            if w <= 0.0 {
                continue;
            }
            acc += w;
            last = *shape;
            if target < acc {
                return *shape;
            }
        }
        last
    }

    /// True when some particle of the effect can be of `shape`.
    pub fn can_be(&self, shape: Shape) -> bool {
        if self.mixed() {
            MIX_SHAPES
                .iter()
                .zip(&self.mix)
                .any(|(s, &w)| *s == shape && w > 0.0)
        } else {
            self.shape == shape
        }
    }

    /// The `FXAM` payload of these parameters: [`FXAM_BYTES`] bytes, or [`FXAM_S3_BYTES`] when
    /// they have S3 fields ([`AmbientParams::has_s3_fields`]).
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(FXAM_S3_BYTES);
        let mut u = |v: u32| out.extend_from_slice(&v.to_le_bytes());
        u(self.kind);
        u(self.seed);
        u(self.time.to_bits());
        u(self.count);
        for v in self.region_centre.iter().chain(&self.region_half) {
            u(v.to_bits());
        }
        u(self.band[0].to_bits());
        u(self.band[1].to_bits());
        u(self.size_mm.to_bits());
        u(self.size_var.to_bits());
        u(self.shape.to_u32());
        u(self.fall_speed.to_bits());
        u(self.fall_var.to_bits());
        for v in self
            .wind
            .iter()
            .chain(&self.turbulence)
            .chain(&self.cloud_centre)
        {
            u(v.to_bits());
        }
        u(self.cloud_radius.to_bits());
        u(self.cloud_softness.to_bits());
        u(self.material_id);
        u(self.tint_var.to_bits());
        u(self.flags);
        u(self.streak.to_bits());
        u(self.gravity.to_bits());
        u(self.energy.to_bits());
        u(self.spin.to_bits());
        u(self.palette_count);
        for v in self.palette.iter().flatten() {
            u(v.to_bits());
        }
        u(self.forward.to_bits());
        u(self.forward_g.to_bits());
        if self.has_s3_fields() {
            for v in self
                .mix
                .iter()
                .chain(&[self.drop_tail, self.drop_tip, self.shape_var])
            {
                u(v.to_bits());
            }
        }
        out
    }

    /// True when the particles are seen by rays of this kind (`FLAG_*`).
    pub fn visible_to(&self, flag: u32) -> bool {
        self.flags & flag != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn sample() -> AmbientParams {
        AmbientParams {
            kind: 3,
            seed: 77,
            time: 1.5,
            count: 1234,
            region_centre: [1.0, -2.0, 150.0],
            region_half: [200.0, 150.0, 140.0],
            band: [10.0, 250.0],
            size_mm: 0.8,
            size_var: 0.3,
            shape: Shape::Capsule,
            fall_speed: 6500.0,
            fall_var: 0.2,
            wind: [300.0, -50.0, 0.0],
            turbulence: [2.0, 80.0, 30.0],
            cloud_centre: [0.0, 10.0, 20.0],
            cloud_radius: 0.0,
            cloud_softness: 0.5,
            material_id: 2,
            tint_var: 0.1,
            flags: FLAG_CAMERA | FLAG_SHADOW,
            streak: 0.012,
            gravity: 0.9,
            energy: 120.0,
            spin: 1.5,
            palette_count: 2,
            palette: [
                [1.0, 0.2, 0.1],
                [0.1, 0.4, 1.0],
                [1.0, 1.0, 1.0],
                [1.0, 1.0, 1.0],
            ],
            forward: 0.5,
            forward_g: 0.7,
            mix: [0.0; 4],
            drop_tail: DROP_TAIL,
            drop_tip: DROP_TIP,
            shape_var: 0.0,
        }
    }

    #[test]
    fn round_trips_and_has_the_documented_size_and_offsets() {
        let p = sample();
        let bytes = p.encode();
        assert_eq!(bytes.len(), FXAM_BYTES);
        const { assert!(FXAM_BYTES <= 256) };
        assert_eq!(AmbientParams::decode(&bytes), Ok(p));
        let word = |off: usize| u32::from_le_bytes(bytes[off..off + 4].try_into().unwrap());
        let float = |off: usize| f32::from_bits(word(off));
        assert_eq!((word(0), word(4), float(8), word(12)), (3, 77, 1.5, 1234));
        assert_eq!(
            (float(16), float(28), float(40), float(44)),
            (1.0, 200.0, 10.0, 250.0)
        );
        assert_eq!((float(48), float(52), word(56)), (0.8, 0.3, 2));
        assert_eq!((float(60), float(64), float(68)), (6500.0, 0.2, 300.0));
        assert_eq!((float(80), float(84), float(88)), (2.0, 80.0, 30.0));
        assert_eq!((float(92), float(104), float(108)), (0.0, 0.0, 0.5));
        assert_eq!(
            (word(112), float(116), word(120), float(124)),
            (2, 0.1, 5, 0.012)
        );
        assert_eq!(
            (float(128), float(132), float(136), word(140)),
            (0.9, 120.0, 1.5, 2)
        );
        assert_eq!((float(144), float(156 + 4)), (1.0, 0.4));
        assert_eq!((float(192), float(196)), (0.5, 0.7));
    }

    #[test]
    fn a_payload_with_only_the_brief_fields_reads_the_rest_as_defaults() {
        let p = sample();
        let bytes = p.encode();
        let short = AmbientParams::decode(&bytes[..FXAM_MIN_BYTES]).unwrap();
        assert_eq!(short.gravity, 1.0);
        assert_eq!(
            (short.energy, short.spin, short.palette_count),
            (0.0, 0.0, 0)
        );
        assert_eq!(short.palette, AmbientParams::default().palette);
        assert_eq!(short.streak, p.streak);
        // A payload of S4a (192 bytes) has no forward lobe.
        let s4a = AmbientParams::decode(&bytes[..192]).unwrap();
        assert_eq!((s4a.forward, s4a.forward_g), (0.0, 0.0));
        assert_eq!(s4a.palette, p.palette);
        // Longer payloads (a newer writer) are read as far as this version knows them: past the
        // S3 fields (which a payload of S4b leaves out and a longer one must have, S3).
        let s3 = AmbientParams {
            shape_var: 0.5,
            ..p
        };
        let mut long = s3.encode();
        assert_eq!(long.len(), FXAM_S3_BYTES);
        long.extend_from_slice(&[0xff; 28]);
        assert_eq!(AmbientParams::decode(&long), Ok(s3));
        assert_eq!(
            AmbientParams::decode(&bytes[..FXAM_MIN_BYTES - 1]),
            Err(FxamError::TooShort)
        );
    }

    #[test]
    fn rejects_bad_values() {
        let check = |f: &dyn Fn(&mut AmbientParams)| {
            let mut p = sample();
            f(&mut p);
            AmbientParams::decode(&p.encode())
        };
        assert!(check(&|p| p.count = MAX_COUNT).is_ok());
        assert!(check(&|p| p.count = MAX_COUNT + 1).is_err());
        assert!(check(&|p| p.size_mm = -1.0).is_err());
        assert!(check(&|p| p.region_half[2] = -0.5).is_err());
        assert!(check(&|p| p.cloud_radius = -3.0).is_err());
        assert!(check(&|p| p.turbulence[1] = -3.0).is_err());
        assert!(check(&|p| p.palette_count = 5).is_err());
        assert!(check(&|p| p.time = f32::NAN).is_err());
        assert!(check(&|p| p.wind[1] = f32::INFINITY).is_err());
        assert!(check(&|p| p.forward = 1.0).is_ok());
        assert!(check(&|p| p.forward = 1.01).is_err());
        assert!(check(&|p| p.forward = -0.1).is_err());
        assert!(check(&|p| p.forward_g = -0.99).is_ok());
        assert!(check(&|p| p.forward_g = 1.0).is_err());
        assert!(check(&|p| p.forward_g = f32::NAN).is_err());
        // Negative gravity rises, a negative time is a time: both are fine.
        assert!(check(&|p| p.gravity = -1.0).is_ok());
        assert!(check(&|p| p.time = -2.0).is_ok());
        assert_eq!(Shape::from_u32(9), Shape::Sphere);
        for s in [Shape::Sphere, Shape::Disc, Shape::Capsule, Shape::Drop] {
            assert_eq!(Shape::from_u32(s.to_u32()), s);
        }
        assert!(!FxamError::TooShort.to_string().is_empty());
        // S3.
        assert!(check(&|p| p.mix = [0.0, 1.0, 0.0, 2.0]).is_ok());
        assert!(check(&|p| p.mix = [0.0, -1.0, 0.0, 2.0]).is_err());
        assert!(check(&|p| p.mix[3] = f32::INFINITY).is_err());
        assert!(check(&|p| p.drop_tail = MAX_DROP_TAIL).is_ok());
        assert!(check(&|p| p.drop_tail = MAX_DROP_TAIL + 0.5).is_err());
        assert!(check(&|p| p.drop_tail = -0.1).is_err());
        assert!(check(&|p| p.drop_tip = 1.0).is_ok());
        assert!(check(&|p| p.drop_tip = 1.1).is_err());
        assert!(check(&|p| p.shape_var = 1.0).is_ok());
        assert!(check(&|p| p.shape_var = -0.2).is_err());
    }

    #[test]
    fn the_s3_fields_are_written_only_when_set_and_read_back() {
        // Without them: the 200 bytes of S4b.
        let plain = sample();
        assert!(!plain.has_s3_fields());
        assert_eq!(plain.encode().len(), FXAM_BYTES);
        // A drop, a mix, a variation or another drop each brings the 28 bytes of S3.
        let cases: [&dyn Fn(&mut AmbientParams); 5] = [
            &|p| p.shape = Shape::Drop,
            &|p| p.mix = [1.0, 0.0, 0.0, 1.0],
            &|p| p.shape_var = 0.25,
            &|p| p.drop_tail = 2.5,
            &|p| p.drop_tip = 0.3,
        ];
        for f in cases {
            let mut p = sample();
            f(&mut p);
            assert!(p.has_s3_fields());
            let bytes = p.encode();
            assert_eq!(bytes.len(), FXAM_S3_BYTES);
            const { assert!(FXAM_S3_BYTES <= 256) };
            assert_eq!(AmbientParams::decode(&bytes), Ok(p));
        }
        let p = AmbientParams {
            shape: Shape::Drop,
            mix: [0.5, 0.25, 0.125, 2.0],
            drop_tail: 2.25,
            drop_tip: 0.2,
            shape_var: 0.4,
            ..sample()
        };
        let bytes = p.encode();
        let float = |off: usize| f32::from_le_bytes(bytes[off..off + 4].try_into().unwrap());
        assert_eq!(u32::from_le_bytes(bytes[56..60].try_into().unwrap()), 3);
        assert_eq!(
            (float(200), float(204), float(208), float(212)),
            (0.5, 0.25, 0.125, 2.0)
        );
        assert_eq!((float(216), float(220), float(224)), (2.25, 0.2, 0.4));
        // A payload of S4b reads the defaults: no mix, the default drop, no variation.
        let s4b = AmbientParams::decode(&bytes[..FXAM_BYTES]).unwrap();
        assert_eq!(s4b.mix, [0.0; 4]);
        assert_eq!(
            (s4b.drop_tail, s4b.drop_tip, s4b.shape_var),
            (DROP_TAIL, DROP_TIP, 0.0)
        );
        assert_eq!(s4b.shape, Shape::Drop);
    }

    #[test]
    fn a_mix_picks_its_shapes_by_their_weights() {
        let mut p = sample();
        assert!(!p.mixed());
        assert_eq!(p.shape_for(0.99), Shape::Capsule);
        assert!(p.can_be(Shape::Capsule) && !p.can_be(Shape::Drop));
        p.mix = [1.0, 0.0, 1.0, 2.0];
        assert!(p.mixed());
        assert_eq!(p.shape_for(0.0), Shape::Sphere);
        assert_eq!(p.shape_for(0.2499), Shape::Sphere);
        assert_eq!(p.shape_for(0.25), Shape::Capsule);
        assert_eq!(p.shape_for(0.4999), Shape::Capsule);
        assert_eq!(p.shape_for(0.5), Shape::Drop);
        assert_eq!(p.shape_for(0.9999999), Shape::Drop);
        assert!(p.can_be(Shape::Sphere) && p.can_be(Shape::Drop) && !p.can_be(Shape::Disc));
        // The draw rounding past the last weight still lands on the last shape that has one.
        assert_eq!(p.shape_for(1.0), Shape::Drop);
    }
}

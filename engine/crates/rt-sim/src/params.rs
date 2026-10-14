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
//! ---- 192 B
//! ```

use std::fmt;

/// Bytes a payload must have: the fields of the brief.
pub const FXAM_MIN_BYTES: usize = 128;
/// Bytes this version writes.
pub const FXAM_BYTES: usize = 192;
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
}

impl Shape {
    /// Decodes the `FXAM` value: 1 disc, 2 capsule, anything else (0, and values a newer writer
    /// may add) a sphere.
    pub fn from_u32(value: u32) -> Shape {
        match value {
            1 => Shape::Disc,
            2 => Shape::Capsule,
            _ => Shape::Sphere,
        }
    }

    /// The `FXAM` value of this shape.
    pub fn to_u32(self) -> u32 {
        match self {
            Shape::Sphere => 0,
            Shape::Disc => 1,
            Shape::Capsule => 2,
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
    /// non-finite number, a negative size, radius or scale, more than [`MAX_COUNT`] particles or
    /// more than [`MAX_PALETTE`] tints.
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
        };
        if p.palette_count as usize > MAX_PALETTE {
            return Err(FxamError::Invalid("palette_count must be at most 4"));
        }
        for tint in p.palette.iter_mut() {
            if r.has(12) {
                *tint = r.vec3()?;
            }
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

    /// The `FXAM` payload of these parameters ([`FXAM_BYTES`] bytes).
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(FXAM_BYTES);
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
        // Longer payloads (a newer writer) are read as far as this version knows them.
        let mut long = bytes.clone();
        long.extend_from_slice(&[0xff; 40]);
        assert_eq!(AmbientParams::decode(&long), Ok(p));
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
        // Negative gravity rises, a negative time is a time: both are fine.
        assert!(check(&|p| p.gravity = -1.0).is_ok());
        assert!(check(&|p| p.time = -2.0).is_ok());
        assert_eq!(Shape::from_u32(9), Shape::Sphere);
        for s in [Shape::Sphere, Shape::Disc, Shape::Capsule] {
            assert_eq!(Shape::from_u32(s.to_u32()), s);
        }
        assert!(!FxamError::TooShort.to_string().is_empty());
    }
}

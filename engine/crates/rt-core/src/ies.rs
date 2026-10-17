//! IES photometric profiles (phase L5): a reader of the IES LM-63 text format, and the intensity
//! distribution it describes.
//!
//! The format is the Illuminating Engineering Society's public text format for the intensity of a
//! luminaire in every direction (ANSI/IES LM-63; the 1995 and 2002 editions share the layout read
//! here, and so does the 1991 one, which has no version line). A file is a header of `[KEYWORD]
//! value` lines (`[MORE]` continues the line before it), the line `TILT=NONE`, thirteen numbers,
//! the vertical angles, the horizontal angles and, for each horizontal angle, the candela at every
//! vertical angle:
//!
//! ```text
//! lamps  lumens_per_lamp  candela_multiplier  n_vertical  n_horizontal  photometric_type  units  width  length  height
//! ballast_factor  ballast_lamp_factor  input_watts
//! vertical angles (n_vertical)        horizontal angles (n_horizontal)
//! candela, n_vertical values for the first horizontal angle, then the second...
//! ```
//!
//! Numbers may be separated by spaces, tabs, commas or line breaks, as files in the wild do.
//!
//! **What is read.** Type C photometry (`photometric_type` 1), the one nearly every luminaire is
//! published in: the vertical angle `γ` is measured from the axis of the luminaire (its nadir, 0°)
//! and the horizontal angle `φ` around it. Vertical angles run 0–90, 0–180 or 90–180; horizontal
//! angles are one (the light is the same all around), or 0–90 (the four quadrants are mirror
//! images), 0–180 (mirrored about the 0–180 plane), 90–270 (mirrored about the 90–270 plane) or
//! 0–360. Type B and type A photometry (`2` and `3`, measured about a horizontal axis) are
//! **refused** with their own message: converting them is a resampling of the sphere that the
//! users of this program do not need, since every luminaire can be published in type C.
//! `TILT=INCLUDE` (a table that changes the output as the lamp tilts) and `TILT=<file>` are
//! refused too, with a message that says so; `TILT=NONE` is required. The candela multiplier of the
//! file is applied; the lamp count, the lumens, the ballast factors, the input watts and the size of
//! the luminous opening are read and ignored (the file's distribution is used as a *shape*, see
//! below).
//!
//! **Strictness.** A malformed file is an error with a message that says what is wrong, never a
//! guess: counts that do not match the numbers present (fewer: a truncated file; more: the counts
//! are wrong), angles that do not increase, negative or non-finite values, a range of angles the
//! standard does not allow, a file of more than [`MAX_BYTES`] bytes, and a distribution with no
//! light at all.
//!
//! **The distribution.** [`IesProfile::intensity`] interpolates the candela bilinearly in `γ` and
//! `φ` between the table's angles (which need not be evenly spaced), after reducing `φ` to the
//! stored range by the file's symmetry; outside the vertical range it is 0 (a downlight sends no
//! light upwards). [`IesProfile::intensity_dir`] takes a unit direction in the luminaire's own frame:
//! `+z` is the axis (`γ = 0`), `φ = 0` lies along `+y`, and `φ` increases from `+y` towards `+x`
//! (counter-clockwise looking along the axis from behind the luminaire, which is how the standard
//! draws the horizontal angle seen from above a downlight). [`IesProfile::flux`] integrates the very
//! same interpolant over the sphere, in closed form per cell (the trapezoid rule is exact for a
//! function that is linear in `φ`, and the vertical integral of `sin γ` times a linear function has
//! a closed form), so it is the flux of what the engine renders, not an estimate of it.
//!
//! The engine uses a profile as a *shape*: it divides by the peak candela
//! ([`IesProfile::peak`]) and scales by the light's own power, so a profile written for 500 lumens
//! and one written for 5000 give the same picture (see `crate::light`).
//!
//! All arithmetic is `f32` with the deterministic functions of [`crate::fmath`]; the text is
//! parsed by `str::parse::<f32>`, which is correctly rounded on every platform.

use crate::fmath;
use crate::math::Vec3;
use std::fmt;

/// Largest file read, in bytes. Real profiles are a few kilobytes to a few hundred; a goniometer
/// table of 1° steps over the whole sphere is under 1 MB.
pub const MAX_BYTES: usize = 2 * 1024 * 1024;

/// Most angles of either kind a file may declare (a 0.1° table of the whole sphere has 3 601).
pub const MAX_ANGLES: usize = 4096;

/// Degrees to radians.
const DEG: f32 = fmath::DEG_TO_RAD;
/// Radians to degrees.
const RAD: f32 = 180.0 / fmath::PI;
/// How close to a standard value (0, 90, 180, 270, 360) an angle must be, in degrees.
const ANGLE_EPS: f32 = 1.0e-3;

/// How the horizontal angles of a type C table cover the circle: the symmetry of the luminaire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Symmetry {
    /// One horizontal angle: the same at every `φ` (a lamp that is round about its axis).
    Rotational,
    /// 0° to 90°: the four quadrants are mirror images of one another.
    Quadrant,
    /// 0° to 180°: mirrored about the 0°–180° plane.
    Bilateral0,
    /// 90° to 270°: mirrored about the 90°–270° plane.
    Bilateral90,
    /// 0° to 360°: every direction is in the table.
    Full,
}

impl Symmetry {
    /// How many times the stored range of `φ` fits in the circle: the weight of its flux.
    fn copies(self) -> f32 {
        match self {
            Symmetry::Rotational | Symmetry::Full => 1.0,
            Symmetry::Bilateral0 | Symmetry::Bilateral90 => 2.0,
            Symmetry::Quadrant => 4.0,
        }
    }
}

/// Why a file is not a profile this engine can use.
#[derive(Clone, Debug, PartialEq)]
pub enum IesError {
    /// The file is longer than [`MAX_BYTES`].
    TooLarge,
    /// There is no `TILT=` line, so no table follows.
    MissingTilt,
    /// `TILT=INCLUDE`: the file carries a tilt table, which is not supported.
    TiltIncluded,
    /// `TILT=` names another file (the 1986 edition's way), which is not supported.
    TiltFile,
    /// A value of the table is not a number (or is not finite). The position is that of the value
    /// among the numbers after `TILT=`, from 1.
    NotANumber(usize),
    /// Fewer numbers than the thirteen of the header.
    ShortHeader,
    /// A count that must be a whole number of at least one is not.
    BadCount,
    /// More angles than [`MAX_ANGLES`].
    TooManyAngles,
    /// Photometric type B (2) or A (3): refused (type C only).
    UnsupportedType(u32),
    /// A photometric type that is none of 1, 2, 3.
    BadType,
    /// The candela multiplier is not positive.
    BadMultiplier,
    /// Fewer numbers than the counts declare: the file is cut short (`expected`, `found`).
    Truncated {
        /// Numbers the counts call for.
        expected: usize,
        /// Numbers present.
        found: usize,
    },
    /// More numbers than the counts declare: the counts are wrong (`expected`, `found`).
    TooManyValues {
        /// Numbers the counts call for.
        expected: usize,
        /// Numbers present.
        found: usize,
    },
    /// Vertical angles that are fewer than two, do not increase, or are not one of the ranges 0–90,
    /// 0–180 and 90–180 of type C.
    BadVerticalAngles,
    /// Horizontal angles that do not increase or are not one of the sets of the standard.
    BadHorizontalAngles,
    /// A negative candela value.
    NegativeCandela,
    /// Every candela value is zero.
    NoLight,
}

impl IesError {
    /// A short English description with no numbers in it (the RSB reader's `Invalid` reason).
    pub fn reason(&self) -> &'static str {
        match self {
            IesError::TooLarge => "the IES file is too large",
            IesError::MissingTilt => "the IES file has no TILT= line",
            IesError::TiltIncluded => "TILT=INCLUDE is not supported: export the profile with TILT=NONE",
            IesError::TiltFile => "a TILT file is not supported: the profile needs TILT=NONE",
            IesError::NotANumber(_) => "the IES table holds a value that is not a number",
            IesError::ShortHeader => "the IES file ends inside the thirteen numbers of its header",
            IesError::BadCount => "the IES angle counts must be whole numbers of at least one",
            IesError::TooManyAngles => "the IES file declares too many angles",
            IesError::UnsupportedType(_) => "only photometric type C is supported, not type A or B",
            IesError::BadType => "the IES photometric type is not 1, 2 or 3",
            IesError::BadMultiplier => "the IES candela multiplier must be positive",
            IesError::Truncated { .. } => "the IES file has fewer values than its counts declare",
            IesError::TooManyValues { .. } => "the IES file has more values than its counts declare",
            IesError::BadVerticalAngles => "the IES vertical angles must increase and run 0-90, 0-180 or 90-180",
            IesError::BadHorizontalAngles => "the IES horizontal angles must increase and be one angle, 0-90, 0-180, 90-270 or 0-360",
            IesError::NegativeCandela => "the IES table has a negative candela value",
            IesError::NoLight => "the IES table is all zeros: it gives no light",
        }
    }
}

impl fmt::Display for IesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IesError::NotANumber(at) => write!(f, "{} (value {at})", self.reason()),
            IesError::UnsupportedType(t) => write!(
                f,
                "{} (the file says type {})",
                self.reason(),
                if *t == 2 { "B" } else { "A" }
            ),
            IesError::Truncated { expected, found } => write!(
                f,
                "{} (they call for {expected} numbers after TILT=NONE and the file has {found})",
                self.reason()
            ),
            IesError::TooManyValues { expected, found } => write!(
                f,
                "{} (they call for {expected} numbers after TILT=NONE and the file has {found})",
                self.reason()
            ),
            other => f.write_str(other.reason()),
        }
    }
}

impl std::error::Error for IesError {}

/// A photometric profile: the candela of a luminaire in every direction, as an IES file gives it.
#[derive(Clone, Debug, PartialEq)]
pub struct IesProfile {
    /// The file, byte for byte (what the RSB carries and writes back).
    source: Vec<u8>,
    /// Its name: the luminaire's description, else its catalogue number, else the test report's.
    name: String,
    symmetry: Symmetry,
    /// Vertical angles in degrees, strictly increasing.
    vertical: Vec<f32>,
    /// Horizontal angles in degrees, strictly increasing (one entry for [`Symmetry::Rotational`]).
    horizontal: Vec<f32>,
    /// Candela, `horizontal.len()` rows of `vertical.len()` values, the file's multiplier applied.
    candela: Vec<f32>,
    /// The largest candela value.
    peak: f32,
    /// The integral of the intensity over the sphere, in candela steradians.
    flux: f32,
}

impl IesProfile {
    /// Reads an IES file. See the module documentation for what is accepted.
    pub fn parse(bytes: &[u8]) -> Result<IesProfile, IesError> {
        if bytes.len() > MAX_BYTES {
            return Err(IesError::TooLarge);
        }
        let (keywords, data_at) = read_header(bytes)?;
        let numbers = read_numbers(&bytes[data_at..])?;
        if numbers.len() < HEADER_NUMBERS {
            return Err(IesError::ShortHeader);
        }
        // Lamps, lumens per lamp, the multiplier, the two counts and the photometric type; the
        // rest of the header (units, the size of the opening, ballast and watts) is not used.
        let (multiplier, n_vertical, n_horizontal, photometric) =
            (numbers[2], numbers[3], numbers[4], numbers[5]);
        let n_vertical = count(n_vertical)?;
        let n_horizontal = count(n_horizontal)?;
        if n_vertical > MAX_ANGLES || n_horizontal > MAX_ANGLES {
            return Err(IesError::TooManyAngles);
        }
        match whole(photometric) {
            Some(1) => {}
            Some(t @ (2 | 3)) => return Err(IesError::UnsupportedType(t)),
            _ => return Err(IesError::BadType),
        }
        if multiplier <= 0.0 {
            return Err(IesError::BadMultiplier);
        }
        let expected = HEADER_NUMBERS + n_vertical + n_horizontal + n_vertical * n_horizontal;
        if numbers.len() < expected {
            return Err(IesError::Truncated {
                expected,
                found: numbers.len(),
            });
        }
        if numbers.len() > expected {
            return Err(IesError::TooManyValues {
                expected,
                found: numbers.len(),
            });
        }
        let at = HEADER_NUMBERS;
        let vertical = numbers[at..at + n_vertical].to_vec();
        let horizontal = numbers[at + n_vertical..at + n_vertical + n_horizontal].to_vec();
        let table = &numbers[at + n_vertical + n_horizontal..];
        check_vertical(&vertical)?;
        let symmetry = check_horizontal(&horizontal)?;
        if table.iter().any(|&c| c < 0.0) {
            return Err(IesError::NegativeCandela);
        }
        let candela: Vec<f32> = table.iter().map(|&c| c * multiplier).collect();
        let peak = candela.iter().fold(0.0f32, |p, &c| p.max(c));
        if !(peak > 0.0 && peak.is_finite()) {
            return Err(IesError::NoLight);
        }
        let mut profile = IesProfile {
            source: bytes.to_vec(),
            name: name_of(&keywords),
            symmetry,
            vertical,
            horizontal,
            candela,
            peak,
            flux: 0.0,
        };
        profile.flux = profile.integrate();
        Ok(profile)
    }

    /// The file this profile was read from, byte for byte.
    pub fn source(&self) -> &[u8] {
        &self.source
    }

    /// The profile's name (the luminaire's description, else its catalogue number, else the test
    /// report's; empty when the file says none).
    pub fn name(&self) -> &str {
        &self.name
    }

    /// How the horizontal angles cover the circle.
    pub fn symmetry(&self) -> Symmetry {
        self.symmetry
    }

    /// The vertical angles of the table, degrees.
    pub fn vertical_angles(&self) -> &[f32] {
        &self.vertical
    }

    /// The horizontal angles of the table, degrees.
    pub fn horizontal_angles(&self) -> &[f32] {
        &self.horizontal
    }

    /// The candela at vertical angle `v` of horizontal angle `h` (indices into the two angle lists),
    /// the file's multiplier applied.
    pub fn candela_at(&self, h: usize, v: usize) -> Option<f32> {
        if h >= self.horizontal.len() || v >= self.vertical.len() {
            return None;
        }
        Some(self.candela[h * self.vertical.len() + v])
    }

    /// The largest value of the table, in candela (always positive).
    pub fn peak(&self) -> f32 {
        self.peak
    }

    /// The flux of the distribution: its intensity integrated over the sphere, in candela
    /// steradians (lumens, for a file in candela). The integral of the very function
    /// [`IesProfile::intensity`] evaluates.
    pub fn flux(&self) -> f32 {
        self.flux
    }

    /// The share of the sphere's worth of the peak intensity the profile sends out: `flux / (4π ·
    /// peak)`, in `(0, 1]`; 1 is a lamp that is as bright in every direction as in its brightest.
    pub fn efficiency(&self) -> f32 {
        self.flux / (4.0 * fmath::PI * self.peak)
    }

    /// The intensity in candela towards vertical angle `gamma` and horizontal angle `phi` (degrees,
    /// any value of `phi`: it is reduced by the file's symmetry), interpolated bilinearly; 0 outside
    /// the vertical range of the table.
    pub fn intensity(&self, gamma: f32, phi: f32) -> f32 {
        let v = &self.vertical;
        let last = v.len() - 1;
        // NaN fails both comparisons, and no light is the safe answer to it.
        if !(gamma >= v[0] && gamma <= v[last]) {
            return 0.0;
        }
        let i = cell(v, gamma);
        let t = (gamma - v[i]) / (v[i + 1] - v[i]);
        let n = v.len();
        let along = |row: usize| {
            let a = self.candela[row * n + i];
            let b = self.candela[row * n + i + 1];
            a + (b - a) * t
        };
        if self.horizontal.len() == 1 {
            return along(0);
        }
        let p = self.fold(phi);
        let j = cell(&self.horizontal, p);
        let s = (p - self.horizontal[j]) / (self.horizontal[j + 1] - self.horizontal[j]);
        let a = along(j);
        let b = along(j + 1);
        a + (b - a) * s
    }

    /// The intensity in candela towards the unit direction `local` in the luminaire's own frame (`+z`
    /// its axis, `φ = 0` along `+y`, `φ` increasing from `+y` towards `+x`).
    pub fn intensity_dir(&self, local: Vec3) -> f32 {
        let rho = (local.x * local.x + local.y * local.y).sqrt();
        let gamma = fmath::atan2(rho, local.z) * RAD;
        let phi = if self.horizontal.len() == 1 {
            0.0
        } else {
            fmath::atan2(local.x, local.y) * RAD
        };
        self.intensity(gamma, phi)
    }

    /// [`IesProfile::intensity_dir`] over the peak: the share of the brightest intensity, in `[0, 1]`.
    pub fn shape(&self, local: Vec3) -> f32 {
        (self.intensity_dir(local) / self.peak).min(1.0)
    }

    /// `phi` (any degrees) reduced into the range of the table by the symmetry.
    fn fold(&self, phi: f32) -> f32 {
        let p = phi - 360.0 * (phi / 360.0).floor();
        match self.symmetry {
            Symmetry::Rotational | Symmetry::Full => p,
            Symmetry::Bilateral0 => {
                if p > 180.0 {
                    360.0 - p
                } else {
                    p
                }
            }
            Symmetry::Quadrant => {
                let p = if p > 180.0 { 360.0 - p } else { p };
                if p > 90.0 {
                    180.0 - p
                } else {
                    p
                }
            }
            Symmetry::Bilateral90 => {
                if (90.0..=270.0).contains(&p) {
                    p
                } else {
                    let q = 180.0 - p;
                    if q < 0.0 {
                        q + 360.0
                    } else {
                        q
                    }
                }
            }
        }
    }

    /// The integral of `sin γ` times the intensity along one horizontal row of the table, over the
    /// table's vertical range, in closed form (cell by cell, the intensity is linear in `γ`).
    fn row_integral(&self, row: usize) -> f32 {
        let n = self.vertical.len();
        let mut sum = 0.0f32;
        for i in 0..n - 1 {
            let g0 = self.vertical[i] * DEG;
            let g1 = self.vertical[i + 1] * DEG;
            let a = self.candela[row * n + i];
            let b = self.candela[row * n + i + 1];
            let half = 0.5 * (g1 - g0);
            let mid = 0.5 * (g0 + g1);
            let mean = 0.5 * (a + b);
            let slope = (b - a) / (g1 - g0);
            // ∫ sin γ (mean + slope (γ - mid)) dγ over [mid - half, mid + half].
            sum += mean * 2.0 * fmath::sin(mid) * fmath::sin(half)
                + slope * fmath::cos(mid) * 2.0 * sin_minus_x_cos(half);
        }
        sum
    }

    /// The flux of the interpolant over the sphere, in candela steradians.
    fn integrate(&self) -> f32 {
        let rows = self.horizontal.len();
        if rows == 1 {
            return fmath::TAU * self.row_integral(0);
        }
        let columns: Vec<f32> = (0..rows).map(|j| self.row_integral(j)).collect();
        // Linear in φ between two rows: the integral over the cell is its width times the mean.
        let mut sum = 0.0f32;
        for j in 0..rows - 1 {
            let width = (self.horizontal[j + 1] - self.horizontal[j]) * DEG;
            sum += width * 0.5 * (columns[j] + columns[j + 1]);
        }
        sum * self.symmetry.copies()
    }
}

/// `sin x - x cos x`, which is `x³/3` for small `x` and cancels badly there.
fn sin_minus_x_cos(x: f32) -> f32 {
    if x < 0.05 {
        let x2 = x * x;
        x * x2 * (1.0 / 3.0 - x2 * (1.0 / 30.0 - x2 * (1.0 / 840.0)))
    } else {
        fmath::sin(x) - x * fmath::cos(x)
    }
}

/// Index of the cell of the increasing list `angles` that holds `x` (inside its range): the last
/// cell for the top angle.
fn cell(angles: &[f32], x: f32) -> usize {
    angles
        .partition_point(|&a| a <= x)
        .saturating_sub(1)
        .min(angles.len() - 2)
}

/// Numbers in the header before the angles.
const HEADER_NUMBERS: usize = 13;

/// `x` as a whole number, when it is one.
fn whole(x: f32) -> Option<u32> {
    ((0.0..=1.0e9).contains(&x) && x.fract() == 0.0).then_some(x as u32)
}

/// A count of angles: a whole number of at least one.
fn count(x: f32) -> Result<usize, IesError> {
    match whole(x) {
        Some(n) if n >= 1 => Ok(n as usize),
        _ => Err(IesError::BadCount),
    }
}

/// Whether `a` and `b` are the same angle.
fn same(a: f32, b: f32) -> bool {
    (a - b).abs() < ANGLE_EPS
}

fn increasing(angles: &[f32]) -> bool {
    angles.windows(2).all(|w| w[0] < w[1])
}

fn check_vertical(v: &[f32]) -> Result<(), IesError> {
    let ok = v.len() >= 2
        && increasing(v)
        && (same(v[0], 0.0) && (same(v[v.len() - 1], 90.0) || same(v[v.len() - 1], 180.0))
            || same(v[0], 90.0) && same(v[v.len() - 1], 180.0));
    if ok {
        Ok(())
    } else {
        Err(IesError::BadVerticalAngles)
    }
}

fn check_horizontal(h: &[f32]) -> Result<Symmetry, IesError> {
    if h.len() == 1 {
        return if (0.0..=360.0).contains(&h[0]) {
            Ok(Symmetry::Rotational)
        } else {
            Err(IesError::BadHorizontalAngles)
        };
    }
    if !increasing(h) {
        return Err(IesError::BadHorizontalAngles);
    }
    let (first, last) = (h[0], h[h.len() - 1]);
    if same(first, 0.0) && same(last, 90.0) {
        Ok(Symmetry::Quadrant)
    } else if same(first, 0.0) && same(last, 180.0) {
        Ok(Symmetry::Bilateral0)
    } else if same(first, 90.0) && same(last, 270.0) {
        Ok(Symmetry::Bilateral90)
    } else if same(first, 0.0) && same(last, 360.0) {
        Ok(Symmetry::Full)
    } else {
        Err(IesError::BadHorizontalAngles)
    }
}

/// Splits the header from the table: the `[KEYWORD] value` lines (a `[MORE]` line joined to the one
/// before it) and where the numbers start, after the `TILT=` line.
fn read_header(bytes: &[u8]) -> Result<(Vec<(String, String)>, usize), IesError> {
    let mut keywords: Vec<(String, String)> = Vec::new();
    let mut pos = 0;
    while pos < bytes.len() {
        let end = bytes[pos..]
            .iter()
            .position(|&b| b == b'\n' || b == b'\r')
            .map_or(bytes.len(), |n| pos + n);
        let line = String::from_utf8_lossy(&bytes[pos..end]);
        let line = line.trim();
        // Past the line break; a "\r\n" is one break.
        pos = end;
        if pos < bytes.len() {
            pos += if bytes[pos] == b'\r' && bytes.get(pos + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
        }
        if line.len() >= 5 && line.as_bytes()[..5].eq_ignore_ascii_case(b"TILT=") {
            let value = line[5..].trim();
            return if value.eq_ignore_ascii_case("NONE") {
                Ok((keywords, pos))
            } else if value.eq_ignore_ascii_case("INCLUDE") {
                Err(IesError::TiltIncluded)
            } else {
                Err(IesError::TiltFile)
            };
        }
        if let Some(rest) = line.strip_prefix('[') {
            if let Some(close) = rest.find(']') {
                let key = rest[..close].trim().to_ascii_uppercase();
                let value = rest[close + 1..].trim().to_string();
                if key == "MORE" {
                    if let Some(last) = keywords.last_mut() {
                        if !last.1.is_empty() && !value.is_empty() {
                            last.1.push(' ');
                        }
                        last.1.push_str(&value);
                    }
                } else {
                    keywords.push((key, value));
                }
            }
        }
        // Anything else (the version line, a blank line) says nothing the engine uses.
    }
    Err(IesError::MissingTilt)
}

/// The values of the table: numbers separated by white space or commas.
fn read_numbers(bytes: &[u8]) -> Result<Vec<f32>, IesError> {
    let mut numbers = Vec::new();
    for token in bytes
        .split(|&b| b.is_ascii_whitespace() || b == b',')
        .filter(|t| !t.is_empty())
    {
        let value = std::str::from_utf8(token)
            .ok()
            .and_then(|t| t.parse::<f32>().ok())
            .filter(|v| v.is_finite())
            .ok_or(IesError::NotANumber(numbers.len() + 1))?;
        numbers.push(value);
    }
    Ok(numbers)
}

/// The name of a profile: the luminaire's description, else its catalogue number, else the test
/// report's; at most 80 characters.
fn name_of(keywords: &[(String, String)]) -> String {
    for wanted in ["LUMINAIRE", "LUMCAT", "TEST"] {
        if let Some((_, value)) = keywords.iter().find(|(k, v)| k == wanted && !v.is_empty()) {
            return value.chars().take(80).collect();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests;

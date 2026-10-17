//! The job: what the guard is asked to do (AI-POST.md §4, §7.2), its tolerances, and the binary
//! form a host (the wasm shim) sends it in.
//!
//! The controls mirror `AiPipelineSettings` of `src/core/ai.ts`: integers 0..100, and at 0 the
//! aspect they control does not change. The tolerances are **provisional**: they are a starting
//! point that phase X1b calibrates on real model outputs.

use rt_core::color::Tonemap;
use std::fmt;

/// The img2img strength at Intervention 100 (`MAX_STRENGTH` in `src/core/ai.ts`).
pub const MAX_STRENGTH: f32 = 0.4;
/// Attempts before the guard gives up and the engine image is delivered unchanged
/// (`MAX_ATTEMPTS` in `src/core/ai.ts`).
pub const MAX_ATTEMPTS: u32 = 4;
/// Each retry multiplies the strength by this (`RETRY_FACTOR` in `src/core/ai.ts`).
pub const RETRY_FACTOR: f32 = 0.6;

/// Largest side accepted for a job, in pixels.
pub const MAX_SIDE: u32 = 16_384;
/// Largest job accepted, in pixels (8192 x 4096).
pub const MAX_PIXELS: u64 = 1 << 25;
/// Most material regions a job may describe.
pub const MAX_MATERIALS: usize = 65_000;

/// Why a job, an image or a step was refused. Wrong-sized model output is not an error: it is a
/// failed check (`size`) and the engine image is delivered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PostError(pub String);

impl PostError {
    pub(crate) fn new(message: impl Into<String>) -> PostError {
        PostError(message.into())
    }
}

impl fmt::Display for PostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PostError {}

/// The configurator's controls, each an integer 0..100 (values above 100 are read as 100).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settings {
    /// How much the model may change the image in total; scales every other control.
    pub intervention: u32,
    /// More natural light: local changes of luminance (penumbras, soft highlights).
    pub light: u32,
    /// Bounced light and ambient colour: local changes of colour.
    pub bounce: u32,
    /// Micro-variation and wear: the model's mid band, only in materials that allow wear.
    pub wear: u32,
    /// The style's colour and light mood: the change common to the whole image.
    pub style_strength: u32,
    /// The model's seed, echoed in the report.
    pub seed: u32,
}

impl Settings {
    /// The configurator's defaults (`DEFAULT_AI_PIPELINE` in `src/core/ai.ts`).
    pub const DEFAULT: Settings = Settings {
        intervention: 50,
        light: 50,
        bounce: 40,
        wear: 20,
        style_strength: 30,
        seed: 0,
    };

    /// Every control at 0 (nothing may change).
    pub const NONE: Settings = Settings {
        intervention: 0,
        light: 0,
        bounce: 0,
        wear: 0,
        style_strength: 0,
        seed: 0,
    };
}

impl Default for Settings {
    fn default() -> Settings {
        Settings::DEFAULT
    }
}

/// A control as a fraction in `[0, 1]`.
pub(crate) fn fraction(control: u32) -> f32 {
    control.min(100) as f32 / 100.0
}

/// One material region of the image, as the passes number it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MaterialInfo {
    /// RSB material index + 1, as in the `materialId` pass.
    pub id: u32,
    /// Its name when it was rendered, for the report.
    pub name: String,
    /// The model's mid band (wear, micro-detail) may enter this material.
    pub allows_wear: bool,
    /// Nothing may change here, like the background (an emitter, for instance).
    pub locked: bool,
}

/// Everything the guard tolerates, in one place. **Provisional defaults** (AI-POST.md §3.2): X1b
/// calibrates them on real outputs. The first group are the checks' limits, the second the
/// transfer's caps: the most the log ratio of an aspect may change with its control and the
/// Intervention at 100 (both scale it linearly, so at 0 the aspect cannot change).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tolerances {
    /// Mean ΔE₀₀ of a material region against the engine image (`deltaEMean`).
    pub delta_e_mean: f32,
    /// 95th percentile of ΔE₀₀ of a material region (`deltaEP95`).
    pub delta_e_p95: f32,
    /// Worst edge displacement at id and normal discontinuities, pixels (`edgesPx`).
    pub edges_px: f32,
    /// Floor of the SSIM of the high band (`detailSsim`).
    pub detail_ssim: f32,
    /// Largest relative sharpness change of a block against the blur map (`focus`).
    pub focus: f32,
    /// A block whose mean circle of confusion is at most this is in focus, pixels (`inFocusCoc`).
    pub in_focus_coc: f32,
    /// A block whose mean circle of confusion is at least this is out of focus (`outOfFocusCoc`).
    pub out_of_focus_coc: f32,
    /// Normals further apart than this make an edge, degrees (`creaseDeg`).
    pub crease_deg: f32,
    /// An id or normal edge is checked when its step in log luminance is at least this
    /// (`edgeContrast`).
    pub edge_contrast: f32,
    /// Cap of the local luminance change (Light), natural log (`capLight`).
    pub cap_light: f32,
    /// Cap of the local colour change (Bounce), natural log per channel (`capBounce`).
    pub cap_bounce: f32,
    /// Cap of the change common to the image (Style strength), natural log per channel
    /// (`capStyle`).
    pub cap_style: f32,
    /// Cap of the mid band that enters materials allowing wear (Wear), natural log (`capWear`).
    pub cap_wear: f32,
}

impl Tolerances {
    /// The provisional defaults. C1 doubled the colour and edge limits (2, 3 and 1.5 before): the
    /// guard was all but invisible, and the AI pass changed next to nothing.
    pub const PROVISIONAL: Tolerances = Tolerances {
        delta_e_mean: 4.0,
        delta_e_p95: 6.0,
        edges_px: 3.0,
        detail_ssim: 0.98,
        focus: 0.15,
        in_focus_coc: 1.0,
        out_of_focus_coc: 3.0,
        crease_deg: 30.0,
        edge_contrast: 0.1,
        cap_light: 0.3,
        cap_bounce: 0.15,
        cap_style: 0.2,
        cap_wear: 0.15,
    };

    /// The keys of the fields as the report, the plan and the job's overrides name them, in
    /// declaration order. Stable: add at the end.
    pub const KEYS: [&'static str; 13] = [
        "deltaEMean",
        "deltaEP95",
        "edgesPx",
        "detailSsim",
        "focus",
        "inFocusCoc",
        "outOfFocusCoc",
        "creaseDeg",
        "edgeContrast",
        "capLight",
        "capBounce",
        "capStyle",
        "capWear",
    ];

    fn field_mut(&mut self, key: &str) -> Option<&mut f32> {
        Some(match key {
            "deltaEMean" => &mut self.delta_e_mean,
            "deltaEP95" => &mut self.delta_e_p95,
            "edgesPx" => &mut self.edges_px,
            "detailSsim" => &mut self.detail_ssim,
            "focus" => &mut self.focus,
            "inFocusCoc" => &mut self.in_focus_coc,
            "outOfFocusCoc" => &mut self.out_of_focus_coc,
            "creaseDeg" => &mut self.crease_deg,
            "edgeContrast" => &mut self.edge_contrast,
            "capLight" => &mut self.cap_light,
            "capBounce" => &mut self.cap_bounce,
            "capStyle" => &mut self.cap_style,
            "capWear" => &mut self.cap_wear,
            _ => return None,
        })
    }

    /// The values in the order of [`Tolerances::KEYS`].
    pub fn values(&self) -> [f32; 13] {
        [
            self.delta_e_mean,
            self.delta_e_p95,
            self.edges_px,
            self.detail_ssim,
            self.focus,
            self.in_focus_coc,
            self.out_of_focus_coc,
            self.crease_deg,
            self.edge_contrast,
            self.cap_light,
            self.cap_bounce,
            self.cap_style,
            self.cap_wear,
        ]
    }

    /// Sets the field named `key` (one of [`Tolerances::KEYS`]). A non-finite or negative value,
    /// or an unknown key, is an error.
    pub fn set(&mut self, key: &str, value: f32) -> Result<(), PostError> {
        if !value.is_finite() || value < 0.0 {
            return Err(PostError::new(format!(
                "tolerance {key}: {value} is not a non-negative number"
            )));
        }
        match self.field_mut(key) {
            Some(field) => {
                *field = value;
                Ok(())
            }
            None => Err(PostError::new(format!("unknown tolerance {key:?}"))),
        }
    }
}

impl Default for Tolerances {
    fn default() -> Tolerances {
        Tolerances::PROVISIONAL
    }
}

/// One post-processing job: the image's size and look, the controls, the material regions.
#[derive(Clone, Debug, PartialEq)]
pub struct Job {
    /// Output width: the job's, exactly.
    pub width: u32,
    /// Output height.
    pub height: u32,
    /// The render's tone curve: the model sees the image as the user does.
    pub tonemap: Tonemap,
    /// The render's exposure, EV stops.
    pub exposure_ev: f32,
    /// The configurator's controls.
    pub settings: Settings,
    /// The material regions the passes name (others are guarded with defaults).
    pub materials: Vec<MaterialInfo>,
    /// What the guard tolerates.
    pub tolerances: Tolerances,
    /// `ai-models.json` key of the model, echoed in the report.
    pub model_key: String,
    /// What runs the model (`ai-runtimes.json` key, `ort-web` or `synthetic`), echoed in the report.
    pub runtime: String,
}

impl Job {
    /// A job of `width` x `height` with ACES at 0 EV, no materials and the provisional tolerances.
    pub fn new(width: u32, height: u32, settings: Settings) -> Job {
        Job {
            width,
            height,
            tonemap: Tonemap::Aces,
            exposure_ev: 0.0,
            settings,
            materials: Vec::new(),
            tolerances: Tolerances::PROVISIONAL,
            model_key: String::new(),
            runtime: String::new(),
        }
    }

    /// Checks the size, the controls and the materials.
    pub fn validate(&self) -> Result<(), PostError> {
        if self.width == 0 || self.height == 0 {
            return Err(PostError::new("the job has no pixels"));
        }
        if self.width > MAX_SIDE
            || self.height > MAX_SIDE
            || u64::from(self.width) * u64::from(self.height) > MAX_PIXELS
        {
            return Err(PostError::new(format!(
                "the job is too large: {}x{}",
                self.width, self.height
            )));
        }
        if !self.exposure_ev.is_finite() {
            return Err(PostError::new("the exposure is not a number"));
        }
        if self.materials.len() > MAX_MATERIALS {
            return Err(PostError::new("too many materials"));
        }
        let mut ids: Vec<u32> = self.materials.iter().map(|m| m.id).collect();
        ids.sort_unstable();
        if ids.windows(2).any(|w| w[0] == w[1]) {
            return Err(PostError::new("a material id is listed twice"));
        }
        for (key, value) in Tolerances::KEYS.iter().zip(self.tolerances.values()) {
            if !value.is_finite() || value < 0.0 {
                return Err(PostError::new(format!("tolerance {key} is invalid")));
            }
        }
        Ok(())
    }

    /// Reads the binary form ([`Job::to_bytes`]), little-endian:
    ///
    /// ```text
    /// "RPJ1"
    /// u32 width, u32 height, u32 tonemap (RSB RNDR code), f32 exposure_ev
    /// u32 intervention, light, bounce, wear, style_strength, seed
    /// u32 material count, then per material: u32 id, u32 flags (bit 0 allows wear,
    ///     bit 1 locked), str name
    /// str model_key, str runtime
    /// u32 override count, then per override: str key (Tolerances::KEYS), f32 value
    /// ```
    ///
    /// where `str` is a `u32` byte length followed by UTF-8. Nothing may follow.
    pub fn from_bytes(bytes: &[u8]) -> Result<Job, PostError> {
        let mut r = Reader { bytes, pos: 0 };
        if r.take(4)? != b"RPJ1" {
            return Err(PostError::new("not a job: the magic RPJ1 is missing"));
        }
        let width = r.u32()?;
        let height = r.u32()?;
        let tonemap = Tonemap::from_u32(r.u32()?);
        let exposure_ev = r.f32()?;
        let settings = Settings {
            intervention: r.u32()?.min(100),
            light: r.u32()?.min(100),
            bounce: r.u32()?.min(100),
            wear: r.u32()?.min(100),
            style_strength: r.u32()?.min(100),
            seed: r.u32()?,
        };
        let count = r.u32()? as usize;
        if count > MAX_MATERIALS {
            return Err(PostError::new("too many materials"));
        }
        let mut materials = Vec::with_capacity(count);
        for _ in 0..count {
            let id = r.u32()?;
            let flags = r.u32()?;
            let name = r.str()?;
            materials.push(MaterialInfo {
                id,
                name,
                allows_wear: flags & 1 != 0,
                locked: flags & 2 != 0,
            });
        }
        let model_key = r.str()?;
        let runtime = r.str()?;
        let mut tolerances = Tolerances::PROVISIONAL;
        let overrides = r.u32()? as usize;
        if overrides > 64 {
            return Err(PostError::new("too many tolerance overrides"));
        }
        for _ in 0..overrides {
            let key = r.str()?;
            let value = r.f32()?;
            tolerances.set(&key, value)?;
        }
        if r.pos != bytes.len() {
            return Err(PostError::new("unexpected bytes after the job"));
        }
        let job = Job {
            width,
            height,
            tonemap,
            exposure_ev,
            settings,
            materials,
            tolerances,
            model_key,
            runtime,
        };
        job.validate()?;
        Ok(job)
    }

    /// The binary form read by [`Job::from_bytes`]; tolerances that differ from the
    /// provisional defaults are written as overrides.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = b"RPJ1".to_vec();
        let u32_ = |out: &mut Vec<u8>, v: u32| out.extend_from_slice(&v.to_le_bytes());
        u32_(&mut out, self.width);
        u32_(&mut out, self.height);
        u32_(&mut out, self.tonemap.to_u32());
        out.extend_from_slice(&self.exposure_ev.to_le_bytes());
        let s = &self.settings;
        for v in [
            s.intervention,
            s.light,
            s.bounce,
            s.wear,
            s.style_strength,
            s.seed,
        ] {
            u32_(&mut out, v);
        }
        u32_(&mut out, self.materials.len() as u32);
        for m in &self.materials {
            u32_(&mut out, m.id);
            u32_(
                &mut out,
                u32::from(m.allows_wear) | u32::from(m.locked) << 1,
            );
            write_str(&mut out, &m.name);
        }
        write_str(&mut out, &self.model_key);
        write_str(&mut out, &self.runtime);
        let defaults = Tolerances::PROVISIONAL.values();
        let changed: Vec<(usize, f32)> = self
            .tolerances
            .values()
            .into_iter()
            .enumerate()
            .filter(|&(i, v)| v.to_bits() != defaults[i].to_bits())
            .collect();
        u32_(&mut out, changed.len() as u32);
        for (i, v) in changed {
            write_str(&mut out, Tolerances::KEYS[i]);
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }
}

fn write_str(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s.as_bytes());
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], PostError> {
        let end = self
            .pos
            .checked_add(n)
            .filter(|&e| e <= self.bytes.len())
            .ok_or_else(|| PostError::new("the job ends too early"))?;
        let out = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(out)
    }

    fn u32(&mut self) -> Result<u32, PostError> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f32(&mut self) -> Result<f32, PostError> {
        Ok(f32::from_bits(self.u32()?))
    }

    fn str(&mut self) -> Result<String, PostError> {
        let len = self.u32()? as usize;
        if len > 4096 {
            return Err(PostError::new("a string of the job is too long"));
        }
        let b = self.take(len)?;
        String::from_utf8(b.to_vec()).map_err(|_| PostError::new("a string is not UTF-8"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Job {
        let mut job = Job::new(640, 480, Settings::DEFAULT);
        job.tonemap = Tonemap::Agx;
        job.exposure_ev = -0.5;
        job.materials = vec![
            MaterialInfo {
                id: 1,
                name: "Brushed aluminium".into(),
                allows_wear: true,
                locked: false,
            },
            MaterialInfo {
                id: 3,
                name: "LED · rojo".into(),
                allows_wear: false,
                locked: true,
            },
        ];
        job.model_key = "ZIMAGE_Q4".into();
        job.runtime = "synthetic".into();
        job.tolerances.delta_e_mean = 1.5;
        job
    }

    #[test]
    fn the_binary_form_round_trips() {
        let job = sample();
        let bytes = job.to_bytes();
        assert_eq!(Job::from_bytes(&bytes), Ok(job.clone()));
        // Only the changed tolerance travels.
        assert_eq!(bytes.windows(10).filter(|w| w == b"deltaEMean").count(), 1);
        let plain = Job::new(8, 8, Settings::NONE);
        assert_eq!(Job::from_bytes(&plain.to_bytes()), Ok(plain));
    }

    #[test]
    fn bad_jobs_are_refused_with_a_reason() {
        let bytes = sample().to_bytes();
        assert!(Job::from_bytes(&bytes[..bytes.len() - 1]).is_err());
        let mut extra = bytes.clone();
        extra.push(0);
        assert!(Job::from_bytes(&extra).is_err());
        assert!(Job::from_bytes(b"RSB1").is_err());
        let mut zero = sample();
        zero.width = 0;
        assert!(Job::from_bytes(&zero.to_bytes()).is_err());
        let mut huge = sample();
        huge.width = MAX_SIDE + 1;
        assert!(huge.validate().is_err());
        let mut twice = sample();
        twice.materials[1].id = 1;
        assert!(twice.validate().is_err());
        let mut t = Tolerances::PROVISIONAL;
        assert!(t.set("nope", 1.0).is_err());
        assert!(t.set("edgesPx", f32::NAN).is_err());
        assert!(t.set("edgesPx", -1.0).is_err());
        assert!(t.set("edgesPx", 2.0).is_ok());
        assert_eq!(t.edges_px, 2.0);
    }

    #[test]
    fn controls_above_100_read_as_100() {
        let mut job = sample();
        job.settings.light = 250;
        let back = Job::from_bytes(&job.to_bytes()).unwrap();
        assert_eq!(back.settings.light, 100);
        assert_eq!(fraction(250), 1.0);
        assert_eq!(fraction(0), 0.0);
    }

    #[test]
    fn every_tolerance_key_names_its_field() {
        let mut t = Tolerances::PROVISIONAL;
        for (i, key) in Tolerances::KEYS.iter().enumerate() {
            t.set(key, 100.0 + i as f32).unwrap();
        }
        let values = t.values();
        for (i, v) in values.iter().enumerate() {
            assert_eq!(*v, 100.0 + i as f32, "{}", Tolerances::KEYS[i]);
        }
    }
}

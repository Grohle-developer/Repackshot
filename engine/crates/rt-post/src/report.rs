//! The guard's report (`GuardReport` in `src/core/ai.ts`) and the JSON it travels as, written by
//! hand like the rest of the engine's JSON: keys in the interface's order, numbers rounded to four
//! decimals (Rust's float formatting is exact and the same on every platform).

use std::fmt::Write as _;

/// One measured check: `ok` is the verdict, whether the limit is a floor or a ceiling.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Check {
    /// Passed.
    pub ok: bool,
    /// What was measured, in the check's unit.
    pub value: f32,
    /// Its limit, in the same unit.
    pub limit: f32,
}

impl Check {
    /// A check whose value must be at most `limit`.
    pub fn ceiling(value: f32, limit: f32) -> Check {
        Check {
            ok: value <= limit,
            value,
            limit,
        }
    }

    /// A check whose value must be at least `limit`.
    pub fn floor(value: f32, limit: f32) -> Check {
        Check {
            ok: value >= limit,
            value,
            limit,
        }
    }
}

/// The colour check of one material region.
#[derive(Clone, Debug, PartialEq)]
pub struct MaterialCheck {
    /// RSB material index + 1.
    pub material_id: u32,
    /// The material's name when it was rendered.
    pub name: String,
    /// Mean ΔE₀₀ against the engine image.
    pub delta_e_mean: f32,
    /// 95th percentile of ΔE₀₀.
    pub delta_e_p95: f32,
    /// Limit on the mean (the percentile's is in the tolerances).
    pub limit: f32,
    /// Both within their limits.
    pub ok: bool,
}

/// ACCEPTED: passed at the asked strength. LIMITED: passed after the strength was lowered.
/// REJECTED: no attempt passed; the delivered image is the engine's, unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Passed at once.
    Accepted,
    /// Passed after lowering the strength.
    Limited,
    /// Nothing passed.
    Rejected,
}

impl Verdict {
    /// The key of `GuardVerdict`.
    pub fn key(self) -> &'static str {
        match self {
            Verdict::Accepted => "ACCEPTED",
            Verdict::Limited => "LIMITED",
            Verdict::Rejected => "REJECTED",
        }
    }
}

/// What the guard reports with every AI image.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    /// The verdict.
    pub verdict: Verdict,
    /// Fraction of the asked strength used: 1 at once, 0 when rejected.
    pub used_fraction: f32,
    /// Attempts made (0 when the model never ran).
    pub attempts: u32,
    /// Every tile came back at its size and the output is the job's size (1 or 0, limit 1).
    pub size: Check,
    /// Pixels changed outside the regions the controls allow (limit 0).
    pub outside: Check,
    /// Worst edge displacement at id and normal discontinuities, pixels.
    pub edges: Check,
    /// SSIM of the high band (a floor).
    pub detail: Check,
    /// Worst per-block sharpness deviation against the blur map.
    pub focus: Check,
    /// Per material region present.
    pub materials: Vec<MaterialCheck>,
    /// Why it was limited or rejected, in English, for the log.
    pub reason: Option<String>,
    /// `ai-models.json` key of the model.
    pub model_key: String,
    /// What ran the model.
    pub runtime: String,
    /// The seed.
    pub seed: u32,
    /// Seconds spent (the guard has no clock: 0 here, the driver fills it in).
    pub seconds: f32,
}

impl Report {
    /// Whether every check passed.
    pub fn all_ok(&self) -> bool {
        [self.size, self.outside, self.edges, self.detail, self.focus]
            .iter()
            .all(|c| c.ok)
            && self.materials.iter().all(|m| m.ok)
    }

    /// The report as JSON, shaped exactly like `GuardReport`.
    pub fn to_json(&self) -> String {
        let check = |c: &Check| {
            format!(
                "{{\"ok\":{},\"value\":{},\"limit\":{}}}",
                c.ok,
                number(c.value),
                number(c.limit)
            )
        };
        let mut s = String::from("{");
        let _ = write!(
            s,
            "\"verdict\":\"{}\",\"usedFraction\":{},\"attempts\":{},",
            self.verdict.key(),
            number(self.used_fraction),
            self.attempts
        );
        let _ = write!(
            s,
            "\"size\":{},\"outside\":{},\"edges\":{},\"detail\":{},\"focus\":{},\"materials\":[",
            check(&self.size),
            check(&self.outside),
            check(&self.edges),
            check(&self.detail),
            check(&self.focus)
        );
        for (i, m) in self.materials.iter().enumerate() {
            let _ = write!(
                s,
                "{}{{\"materialId\":{},\"name\":{},\"deltaEMean\":{},\"deltaEP95\":{},\"limit\":{},\"ok\":{}}}",
                if i == 0 { "" } else { "," },
                m.material_id,
                string(&m.name),
                number(m.delta_e_mean),
                number(m.delta_e_p95),
                number(m.limit),
                m.ok
            );
        }
        s.push_str("],");
        if let Some(reason) = &self.reason {
            let _ = write!(s, "\"reason\":{},", string(reason));
        }
        let _ = write!(
            s,
            "\"modelKey\":{},\"runtime\":{},\"seed\":{},\"seconds\":{}}}",
            string(&self.model_key),
            string(&self.runtime),
            self.seed,
            number(self.seconds)
        );
        s
    }
}

/// `text` as a JSON string literal, quotes included.
pub fn string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A number as JSON: rounded to four decimals, integers without a fraction, never `-0`, and a
/// value that is not finite as 0 (the guard measures finite values; this only keeps JSON valid).
pub fn number(v: f32) -> String {
    if !v.is_finite() {
        return "0".into();
    }
    let r = if v.abs() < 1.0e6 {
        (v * 10_000.0).round() / 10_000.0
    } else {
        v.round()
    } + 0.0;
    if r.fract() == 0.0 && r.abs() < 1.0e9 {
        format!("{}", r as i64)
    } else {
        format!("{r}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_short_and_valid_json() {
        assert_eq!(number(1.0), "1");
        assert_eq!(number(0.0), "0");
        assert_eq!(number(-0.0), "0");
        assert_eq!(number(-0.000_01), "0");
        assert_eq!(number(0.123_456), "0.1235");
        assert_eq!(number(1.5), "1.5");
        assert_eq!(number(0.98), "0.98");
        assert_eq!(number(12_345_678.0), "12345678");
        assert_eq!(number(f32::NAN), "0");
        assert_eq!(string("a\"b\\c\nd\u{1}é"), "\"a\\\"b\\\\c\\nd\\u0001é\"");
    }

    #[test]
    fn checks_know_floors_and_ceilings() {
        assert!(Check::ceiling(1.5, 1.5).ok);
        assert!(!Check::ceiling(1.6, 1.5).ok);
        assert!(Check::floor(0.98, 0.98).ok);
        assert!(!Check::floor(0.97, 0.98).ok);
    }
}

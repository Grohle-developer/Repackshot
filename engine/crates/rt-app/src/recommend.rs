//! The AI model catalogue (`src/data/ai-models.json`, embedded when the launcher is built) and
//! the recommendation rule of `docs/AI-POST.md` §2.4.
//!
//! The interface evaluates the same table with the same rule (`src/core/ai-recommend.ts`); both
//! are tested against `tests/fixtures/ai-recommend-cases.json`, so the installer and the
//! settings always recommend the same thing.
//!
//! Rule: the rows are tried top to bottom and the first that matches wins. A `gpu` row matches
//! the dedicated VRAM of the chosen GPU, a `cpu` row the RAM, both with an inclusive minimum and
//! an exclusive maximum (`null`: none); a `web` row matches whether the browser has WebGPU and,
//! with it, a largest buffer of at least `minBufferGiB`. A recommended or offered model that is
//! not available is skipped (the recommendation passes to the first available offered model,
//! else none) and listed in `skipped`. A failed detection gives no recommendation at all.

use crate::json::{self, Value};
use std::sync::OnceLock;

/// The catalogue as shipped (`src/data/ai-models.json`).
pub const CATALOGUE_JSON: &str = include_str!("../../../../src/data/ai-models.json");

/// One file of a model.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelFile {
    /// `transformer`, `text-encoder`, `vae`...
    pub role: String,
    /// The file's name (a flat basename).
    pub name: String,
    /// Exact size.
    pub bytes: u64,
    /// SHA-256, 64 lower-case hexadecimal digits: also the blob's name in the store.
    pub sha256: String,
}

/// A model of the catalogue.
#[derive(Clone, Debug, PartialEq)]
pub struct Model {
    /// Stable key.
    pub key: String,
    /// Name in English.
    pub label_en: String,
    /// Name in Spanish.
    pub label_es: String,
    /// One line in English.
    pub summary_en: String,
    /// One line in Spanish.
    pub summary_es: String,
    /// `desktop` and/or `web`.
    pub runtimes: Vec<String>,
    /// The built-in default.
    pub default: bool,
    /// A downloadable build exists.
    pub available: bool,
    /// SPDX identifier of the licence.
    pub licence: String,
    /// The licence allows commercial use.
    pub commercial: bool,
    /// The licence carries use restrictions shown before the download.
    pub restrictions: bool,
    /// The files to download.
    pub files: Vec<ModelFile>,
    /// Their total size.
    pub total_bytes: u64,
}

impl Model {
    /// Runs in the desktop application.
    pub fn desktop(&self) -> bool {
        self.runtimes.iter().any(|r| r == "desktop")
    }
}

/// A row of the recommendation table.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    /// Its id (`gpu-12`...).
    pub id: String,
    /// `gpu`, `cpu` or `web`.
    pub device: String,
    /// Inclusive minimum, GiB.
    pub min_gib: f64,
    /// Exclusive maximum, GiB (`None`: unbounded).
    pub max_gib: Option<f64>,
    /// Web rows: whether WebGPU is there.
    pub webgpu: Option<bool>,
    /// Web rows with WebGPU: the smallest acceptable largest buffer, GiB.
    pub min_buffer_gib: f64,
    /// The recommended key.
    pub recommended: Option<String>,
    /// Keys also offered.
    pub offered: Vec<String>,
}

/// The whole catalogue.
#[derive(Clone, Debug, PartialEq)]
pub struct Catalogue {
    /// The models, in file order.
    pub models: Vec<Model>,
    /// The recommendation table.
    pub rows: Vec<Row>,
    /// Thresholds not measured yet.
    pub provisional: bool,
}

impl Catalogue {
    /// The model with `key`.
    pub fn model(&self, key: &str) -> Option<&Model> {
        self.models.iter().find(|m| m.key == key)
    }
}

/// The embedded catalogue (parsed once; it is tested to parse).
pub fn catalogue() -> &'static Catalogue {
    static CATALOGUE: OnceLock<Catalogue> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        parse_catalogue(CATALOGUE_JSON).unwrap_or_else(|e| {
            crate::log!("ai-models.json: {e}");
            Catalogue {
                models: Vec::new(),
                rows: Vec::new(),
                provisional: true,
            }
        })
    })
}

fn text(v: &Value, key: &str) -> Result<String, String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("missing string '{key}'"))
}

fn label(v: &Value, key: &str) -> Result<(String, String), String> {
    let l = v.get(key).ok_or_else(|| format!("missing '{key}'"))?;
    Ok((text(l, "en")?, text(l, "es")?))
}

fn whole(v: Option<&Value>, what: &str) -> Result<u64, String> {
    match v.and_then(Value::as_f64) {
        Some(n) if n >= 0.0 && n.fract() == 0.0 && n < 9.0e15 => Ok(n as u64),
        _ => Err(format!("'{what}' must be a whole number of bytes")),
    }
}

/// True for a name the store accepts: `[A-Za-z0-9._-]`, 1 to 128 characters, not starting
/// with a dot (so never `.` or `..`).
pub fn valid_name(name: &str) -> bool {
    (1..=128).contains(&name.len())
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

/// True for 64 lower-case hexadecimal digits (a blob name).
pub fn valid_sha256(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Reads the `files` of a model or of an imported manifest.
pub fn parse_files(v: &Value) -> Result<Vec<ModelFile>, String> {
    let files = v
        .get("files")
        .and_then(Value::as_array)
        .ok_or("missing 'files'")?;
    files
        .iter()
        .map(|f| {
            let file = ModelFile {
                role: text(f, "role")?,
                name: text(f, "name")?,
                bytes: whole(f.get("bytes"), "bytes")?,
                sha256: text(f, "sha256")?,
            };
            if !valid_name(&file.name) {
                return Err(format!("bad file name '{}'", file.name));
            }
            if !valid_sha256(&file.sha256) {
                return Err(format!("bad sha256 for '{}'", file.name));
            }
            Ok(file)
        })
        .collect()
}

/// Parses the catalogue.
pub fn parse_catalogue(text_json: &str) -> Result<Catalogue, String> {
    let root = json::parse(text_json).map_err(|e| e.to_string())?;
    let models = root
        .get("models")
        .and_then(Value::as_array)
        .ok_or("missing 'models'")?
        .iter()
        .map(|m| {
            let key = text(m, "key")?;
            let (label_en, label_es) = label(m, "label")?;
            let (summary_en, summary_es) = label(m, "summary")?;
            let licence = m.get("licence").ok_or("missing 'licence'")?;
            let files = parse_files(m).map_err(|e| format!("{key}: {e}"))?;
            Ok(Model {
                runtimes: m
                    .get("runtimes")
                    .and_then(Value::as_array)
                    .ok_or("missing 'runtimes'")?
                    .iter()
                    .filter_map(|r| r.as_str().map(str::to_string))
                    .collect(),
                default: m.get("default").and_then(Value::as_bool).unwrap_or(false),
                available: m.get("available").and_then(Value::as_bool).unwrap_or(false),
                licence: text(licence, "spdx")?,
                commercial: licence
                    .get("commercialUse")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                restrictions: licence
                    .get("useRestrictions")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                total_bytes: whole(m.get("totalBytes"), "totalBytes")?,
                key,
                label_en,
                label_es,
                summary_en,
                summary_es,
                files,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let rows = root
        .get("recommendation")
        .and_then(Value::as_array)
        .ok_or("missing 'recommendation'")?
        .iter()
        .map(|r| {
            Ok(Row {
                id: text(r, "id")?,
                device: text(r, "device")?,
                min_gib: r.get("minGiB").and_then(Value::as_f64).unwrap_or(0.0),
                max_gib: r.get("maxGiB").and_then(Value::as_f64),
                webgpu: r.get("webgpu").and_then(Value::as_bool),
                min_buffer_gib: r.get("minBufferGiB").and_then(Value::as_f64).unwrap_or(0.0),
                recommended: r
                    .get("recommended")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                offered: r
                    .get("offered")
                    .and_then(Value::as_array)
                    .unwrap_or(&[])
                    .iter()
                    .filter_map(|k| k.as_str().map(str::to_string))
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Catalogue {
        models,
        rows,
        provisional: root
            .get("provisional")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// What was detected, as the rule reads it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Input {
    /// Running on a GPU with this much dedicated VRAM.
    Gpu {
        /// GiB.
        vram_gib: f64,
    },
    /// Running on the CPU with this much RAM.
    Cpu {
        /// GiB.
        ram_gib: f64,
    },
    /// In a browser.
    Web {
        /// WebGPU is there.
        webgpu: bool,
        /// The largest buffer, GiB (needed with WebGPU).
        max_buffer_gib: f64,
    },
}

impl Input {
    /// Reads the input of a test case (`null` or a value that is not a usable amount: a failed
    /// detection, `None`).
    pub fn from_json(v: &Value) -> Option<Input> {
        let amount = |key: &str| v.get(key).and_then(Value::as_f64).filter(|n| *n >= 0.0);
        match v.get("device")?.as_str()? {
            "gpu" => Some(Input::Gpu {
                vram_gib: amount("vramGiB")?,
            }),
            "cpu" => Some(Input::Cpu {
                ram_gib: amount("ramGiB")?,
            }),
            "web" => {
                let webgpu = v.get("webgpu")?.as_bool()?;
                let max_buffer_gib = if webgpu { amount("maxBufferGiB")? } else { 0.0 };
                Some(Input::Web {
                    webgpu,
                    max_buffer_gib,
                })
            }
            _ => None,
        }
    }
}

/// The result of the rule.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recommendation {
    /// The deciding row, `None` when the detection worked but no row matches.
    pub row_id: Option<String>,
    /// The recommended key.
    pub recommended: Option<String>,
    /// Keys also offered.
    pub offered: Vec<String>,
    /// Keys of the row left out because their model is not available.
    pub skipped: Vec<String>,
}

fn matches(row: &Row, input: &Input) -> bool {
    let within = |v: f64| v >= row.min_gib && row.max_gib.is_none_or(|max| v < max);
    match *input {
        Input::Gpu { vram_gib } => row.device == "gpu" && within(vram_gib),
        Input::Cpu { ram_gib } => row.device == "cpu" && within(ram_gib),
        Input::Web {
            webgpu,
            max_buffer_gib,
        } => {
            row.device == "web"
                && row.webgpu == Some(webgpu)
                && (!webgpu || max_buffer_gib >= row.min_buffer_gib)
        }
    }
}

/// The rule. `None` input (a failed detection) gives `None`; `unavailable` marks more models as
/// unavailable than the catalogue does (the shared test cases use it).
pub fn recommend(
    catalogue: &Catalogue,
    input: Option<&Input>,
    unavailable: &[String],
) -> Option<Recommendation> {
    let input = input?;
    let finite = match *input {
        Input::Gpu { vram_gib: v } | Input::Cpu { ram_gib: v } => v.is_finite() && v >= 0.0,
        Input::Web { max_buffer_gib, .. } => max_buffer_gib.is_finite(),
    };
    if !finite {
        return None;
    }
    let Some(row) = catalogue.rows.iter().find(|r| matches(r, input)) else {
        return Some(Recommendation {
            row_id: None,
            recommended: None,
            offered: Vec::new(),
            skipped: Vec::new(),
        });
    };
    let usable = |key: &str| {
        !unavailable.iter().any(|u| u == key) && catalogue.model(key).is_some_and(|m| m.available)
    };
    let (mut offered, mut skipped): (Vec<String>, Vec<String>) =
        row.offered.iter().cloned().partition(|k| usable(k));
    let mut recommended = row.recommended.clone();
    if let Some(key) = recommended.clone().filter(|k| !usable(k)) {
        skipped.insert(0, key);
        recommended = if offered.is_empty() {
            None
        } else {
            Some(offered.remove(0))
        };
    }
    Some(Recommendation {
        row_id: Some(row.id.clone()),
        recommended,
        offered,
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../../../tests/fixtures/ai-recommend-cases.json");

    fn keys(v: Option<&Value>) -> Vec<String> {
        v.and_then(Value::as_array)
            .unwrap_or(&[])
            .iter()
            .filter_map(|k| k.as_str().map(str::to_string))
            .collect()
    }

    #[test]
    fn the_embedded_catalogue_parses() {
        let c = parse_catalogue(CATALOGUE_JSON).expect("ai-models.json parses");
        assert!(!c.models.is_empty() && !c.rows.is_empty());
        assert_eq!(c.models.iter().filter(|m| m.default).count(), 1);
        for m in &c.models {
            assert!(valid_name(&m.key), "{}", m.key);
            if !m.files.is_empty() {
                assert_eq!(m.files.iter().map(|f| f.bytes).sum::<u64>(), m.total_bytes);
            }
        }
        assert_eq!(catalogue(), &c);
    }

    #[test]
    fn shared_cases_give_the_same_answers_as_the_interface() {
        // tests/fixtures/ai-recommend-cases.json, also read by tests/ai-recommend.test.ts.
        let cat = catalogue();
        let cases = json::parse(CASES).expect("cases parse");
        let cases = cases.as_array().expect("an array of cases");
        assert!(cases.len() >= 20);
        for case in cases {
            let input = case.get("input").and_then(Input::from_json);
            let unavailable = keys(case.get("unavailable"));
            let got = recommend(cat, input.as_ref(), &unavailable);
            let expect = case.get("expect").expect("expect");
            let label = case.get("input").map(Value::to_json).unwrap_or_default();
            if expect.is_null() {
                assert_eq!(got, None, "{label}");
                continue;
            }
            let got = got.unwrap_or_else(|| panic!("{label}: a recommendation was expected"));
            assert_eq!(
                got.row_id.as_deref(),
                expect.get("rowId").and_then(Value::as_str),
                "{label} row"
            );
            assert_eq!(
                got.recommended.as_deref(),
                expect.get("recommended").and_then(Value::as_str),
                "{label} recommended"
            );
            assert_eq!(got.offered, keys(expect.get("offered")), "{label} offered");
            assert_eq!(got.skipped, keys(expect.get("skipped")), "{label} skipped");
        }
    }

    #[test]
    fn rows_are_evaluated_in_order_and_unknown_models_are_skipped() {
        let mut cat = catalogue().clone();
        cat.rows.insert(
            0,
            Row {
                id: "first".into(),
                device: "gpu".into(),
                min_gib: 0.0,
                max_gib: None,
                webgpu: None,
                min_buffer_gib: 0.0,
                recommended: Some("NOT_A_MODEL".into()),
                offered: vec!["SD15_LIGHT".into()],
            },
        );
        let r = recommend(&cat, Some(&Input::Gpu { vram_gib: 48.0 }), &[]).unwrap();
        assert_eq!(r.row_id.as_deref(), Some("first"));
        assert_eq!(r.recommended.as_deref(), Some("SD15_LIGHT"));
        assert_eq!(r.skipped, ["NOT_A_MODEL"]);
        assert_eq!(
            recommend(&cat, Some(&Input::Gpu { vram_gib: f64::NAN }), &[]),
            None
        );
    }

    #[test]
    fn names() {
        for good in [
            "ZIMAGE_Q8",
            "ae.safetensors",
            "a-b_c.1",
            "Qwen3-4B-Q4_K_M.gguf",
        ] {
            assert!(valid_name(good), "{good}");
        }
        for bad in [
            "",
            ".",
            "..",
            ".hidden",
            "a/b",
            "a\\b",
            "a..b",
            "a b",
            "é",
            &"a".repeat(129),
        ] {
            assert!(!valid_name(bad), "{bad:?}");
        }
        assert!(valid_sha256(&"0a".repeat(32)));
        assert!(!valid_sha256(&"0A".repeat(32)), "lower case only");
        assert!(!valid_sha256(&"0a".repeat(31)));
    }
}

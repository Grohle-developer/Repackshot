//! The inference runtimes (`src/data/ai-runtimes.json`, embedded when the launcher is built): the
//! pinned official builds of stable-diffusion.cpp, the rule that chooses one, and how each model
//! family is run (the arguments that load it and the sampling it takes).
//!
//! **The rule** (the same as `src/core/ai-runtimes.ts`; both pass
//! `tests/fixtures/ai-runtime-cases.json`): the `choice` rows are tried top to bottom and the
//! first that matches wins. A row matches when its `force` equals the forced backend (`null`
//! matches nothing forced) and, if it has `gpu`, when that equals whether the hardware report has
//! a GPU to use (a failed detection is no GPU). The row's backend and the system (`os`, `arch`)
//! pick the build; a system without a pinned build gets the row and no key. An unknown forced
//! backend is not a choice.
//!
//! **Arguments**: `@role` is the path of the model's one file with that role, `@role~text` the
//! one whose name also contains `text` (the two ControlNets of SD 1.5); anything else is passed
//! as written.

use crate::json::{self, Value};
use crate::recommend::{valid_name, valid_sha256, ModelFile};
use std::path::PathBuf;
use std::sync::OnceLock;

/// The file as shipped.
pub const RUNTIMES_JSON: &str = include_str!("../../../../../src/data/ai-runtimes.json");

/// What a build computes on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    /// The graphics card, through Vulkan (NVIDIA, AMD, Intel).
    Vulkan,
    /// The processor.
    Cpu,
}

impl Backend {
    /// `VULKAN` or `CPU`.
    pub fn parse(text: &str) -> Option<Backend> {
        match text {
            "VULKAN" => Some(Backend::Vulkan),
            "CPU" => Some(Backend::Cpu),
            _ => None,
        }
    }

    /// `VULKAN` or `CPU`, as in the JSON and `AiBackend` of `src/core/ai.ts`.
    pub fn name(self) -> &'static str {
        match self {
            Backend::Vulkan => "VULKAN",
            Backend::Cpu => "CPU",
        }
    }
}

/// One pinned build.
#[derive(Clone, Debug, PartialEq)]
pub struct Runtime {
    /// Stable key (`SDCPP_LINUX_CPU`...).
    pub key: String,
    /// `windows` or `linux` (`std::env::consts::OS`).
    pub os: String,
    /// `x86_64` (`std::env::consts::ARCH`).
    pub arch: String,
    /// What it computes on.
    pub backend: Backend,
    /// The archive's file name.
    pub name: String,
    /// Where it is downloaded from (pinned to the release).
    pub url: String,
    /// Exact size of the archive.
    pub bytes: u64,
    /// SHA-256 of the archive; also its folder's name once installed.
    pub sha256: String,
    /// The server executable inside the archive.
    pub server: String,
    /// The command-line executable inside the archive (`--version`, `--list-devices`).
    pub cli: String,
    /// Model keys it loads, as far as the release's documentation and our arguments say.
    pub supports: Vec<String>,
    /// Model keys proven to load on a real computer (X1 part B).
    pub verified: Vec<String>,
}

/// A row of the choice rule.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChoiceRow {
    /// Its id.
    pub id: String,
    /// The forced backend it answers (`None`: nothing forced).
    pub force: Option<Backend>,
    /// Whether a GPU must be (`Some(true)`) or must not be there; `None`: either.
    pub gpu: Option<bool>,
    /// The backend it picks.
    pub backend: Backend,
}

/// How the input image reaches the model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageMode {
    /// As the init image of img2img, with the strength.
    Init,
    /// As the init image and as a reference image (the edit models).
    InitRef,
}

/// A ControlNet a family can load.
#[derive(Clone, Debug, PartialEq)]
pub struct Control {
    /// Arguments that load it (added to the family's).
    pub load: Vec<String>,
    /// `--control-strength`.
    pub strength: f64,
}

/// How a model family is run.
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    /// Arguments that load the model (with `@role` references).
    pub load: Vec<String>,
    /// Sampling steps unless the request says.
    pub steps: u32,
    /// Classifier-free guidance scale.
    pub cfg_scale: f64,
    /// Sampling method (`None`: the model's default).
    pub sampler: Option<String>,
    /// Flow shift (`None`: the model's default).
    pub flow_shift: Option<f64>,
    /// How the image goes in.
    pub image: ImageMode,
    /// ControlNets by kind (`tile`, `depth`).
    pub controls: Vec<(String, Control)>,
}

impl Profile {
    /// The ControlNet of `kind`.
    pub fn control(&self, kind: &str) -> Option<&Control> {
        self.controls
            .iter()
            .find(|(k, _)| k == kind)
            .map(|(_, c)| c)
    }
}

/// The release the builds come from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
    /// The release tag (`master-959-d637cfb`).
    pub tag: String,
    /// Its full commit.
    pub commit: String,
}

/// The whole file.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeCatalogue {
    /// The release.
    pub release: Release,
    /// The builds.
    pub runtimes: Vec<Runtime>,
    /// The choice rule.
    pub rows: Vec<ChoiceRow>,
    /// By model family (`z-image`, `flux2-klein`, `qwen-image-edit`, `sd15`).
    pub profiles: Vec<(String, Profile)>,
}

impl RuntimeCatalogue {
    /// The build with `key`.
    pub fn runtime(&self, key: &str) -> Option<&Runtime> {
        self.runtimes.iter().find(|r| r.key == key)
    }

    /// The profile of a model family.
    pub fn profile(&self, family: &str) -> Option<&Profile> {
        self.profiles
            .iter()
            .find(|(f, _)| f == family)
            .map(|(_, p)| p)
    }
}

/// The embedded file, parsed once (a test checks it parses).
pub fn runtime_catalogue() -> &'static RuntimeCatalogue {
    static CAT: OnceLock<RuntimeCatalogue> = OnceLock::new();
    CAT.get_or_init(|| {
        parse_runtimes(RUNTIMES_JSON).unwrap_or_else(|e| {
            crate::log!("ai-runtimes.json: {e}");
            RuntimeCatalogue {
                release: Release {
                    tag: String::new(),
                    commit: String::new(),
                },
                runtimes: Vec::new(),
                rows: Vec::new(),
                profiles: Vec::new(),
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

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .unwrap_or(&[])
        .iter()
        .filter_map(|s| s.as_str().map(str::to_string))
        .collect()
}

fn backend(v: &Value, key: &str) -> Result<Backend, String> {
    Backend::parse(&text(v, key)?).ok_or_else(|| format!("'{key}' is not VULKAN or CPU"))
}

fn parse_profile(v: &Value) -> Result<Profile, String> {
    let mut controls = Vec::new();
    if let Some(Value::Object(fields)) = v.get("controls") {
        for (kind, c) in fields {
            controls.push((
                kind.clone(),
                Control {
                    load: strings(c.get("load")),
                    strength: c.get("strength").and_then(Value::as_f64).unwrap_or(0.9),
                },
            ));
        }
    }
    let steps = v.get("steps").and_then(Value::as_f64).unwrap_or(20.0);
    if !(1.0..=200.0).contains(&steps) || steps.fract() != 0.0 {
        return Err("'steps' must be a whole number from 1 to 200".into());
    }
    Ok(Profile {
        load: strings(v.get("load")),
        steps: steps as u32,
        cfg_scale: v.get("cfgScale").and_then(Value::as_f64).unwrap_or(7.0),
        sampler: v.get("sampler").and_then(Value::as_str).map(str::to_string),
        flow_shift: v.get("flowShift").and_then(Value::as_f64),
        image: match v.get("image").and_then(Value::as_str) {
            Some("init") | None => ImageMode::Init,
            Some("init+ref") => ImageMode::InitRef,
            Some(other) => return Err(format!("unknown image mode '{other}'")),
        },
        controls,
    })
}

/// Parses `ai-runtimes.json`.
pub fn parse_runtimes(text_json: &str) -> Result<RuntimeCatalogue, String> {
    parse(text_json, false)
}

/// The same, accepting `http://` addresses (a test catalogue pointing at a local server).
pub fn parse_runtimes_allowing_http(text_json: &str) -> Result<RuntimeCatalogue, String> {
    parse(text_json, true)
}

fn parse(text_json: &str, allow_http: bool) -> Result<RuntimeCatalogue, String> {
    let root = json::parse(text_json).map_err(|e| e.to_string())?;
    let rel = root.get("release").ok_or("missing 'release'")?;
    let runtimes = root
        .get("runtimes")
        .and_then(Value::as_array)
        .ok_or("missing 'runtimes'")?
        .iter()
        .map(|r| {
            let key = text(r, "key")?;
            let archive = r.get("archive").ok_or("missing 'archive'")?;
            let rt = Runtime {
                os: text(r, "os")?,
                arch: text(r, "arch")?,
                backend: backend(r, "backend")?,
                name: text(r, "name")?,
                url: text(r, "url")?,
                bytes: r
                    .get("bytes")
                    .and_then(Value::as_f64)
                    .filter(|n| *n > 0.0 && n.fract() == 0.0)
                    .ok_or("'bytes' must be a positive whole number")?
                    as u64,
                sha256: text(r, "sha256")?,
                server: text(archive, "server")?,
                cli: text(archive, "cli")?,
                supports: strings(r.get("supports")),
                verified: strings(r.get("verified")),
                key,
            };
            if !valid_name(&rt.key) || !valid_sha256(&rt.sha256) || !valid_name(&rt.name) {
                return Err(format!("{}: bad key, name or sha256", rt.key));
            }
            if !rt.url.starts_with("https://") && !(allow_http && rt.url.starts_with("http://")) {
                return Err(format!("{}: the URL is not https", rt.key));
            }
            if archive.get("format").and_then(Value::as_str) != Some("zip") {
                return Err(format!("{}: only zip archives are read", rt.key));
            }
            Ok(rt)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let rows = root
        .get("choice")
        .and_then(Value::as_array)
        .ok_or("missing 'choice'")?
        .iter()
        .map(|r| {
            Ok(ChoiceRow {
                id: text(r, "id")?,
                force: match r.get("force") {
                    None | Some(Value::Null) => None,
                    Some(_) => Some(backend(r, "force")?),
                },
                gpu: r.get("gpu").and_then(Value::as_bool),
                backend: backend(r, "backend")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut profiles = Vec::new();
    if let Some(Value::Object(fields)) = root.get("profiles") {
        for (family, p) in fields {
            profiles.push((
                family.clone(),
                parse_profile(p).map_err(|e| format!("{family}: {e}"))?,
            ));
        }
    }
    Ok(RuntimeCatalogue {
        release: Release {
            tag: text(rel, "tag")?,
            commit: text(rel, "commit")?,
        },
        runtimes,
        rows,
        profiles,
    })
}

/// What the rule reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChoiceInput {
    /// `std::env::consts::OS` of the computer.
    pub os: String,
    /// `std::env::consts::ARCH`.
    pub arch: String,
    /// The hardware report has a GPU to use; `None`: the detection failed (no GPU).
    pub gpu: Option<bool>,
    /// The backend the person forced, as written (`VULKAN`, `CPU`), or none.
    pub force: Option<String>,
}

impl ChoiceInput {
    /// Reads the input of a test case (`null`: no input).
    pub fn from_json(v: &Value) -> Option<ChoiceInput> {
        Some(ChoiceInput {
            os: v.get("os")?.as_str()?.to_string(),
            arch: v.get("arch")?.as_str()?.to_string(),
            gpu: v.get("gpu").and_then(Value::as_bool),
            force: v.get("force").and_then(Value::as_str).map(str::to_string),
        })
    }
}

/// The rule's answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    /// The deciding row.
    pub row_id: String,
    /// What it picks.
    pub backend: Backend,
    /// The build for this system, or `None` when none is pinned.
    pub key: Option<String>,
}

/// The rule (see the module's documentation).
pub fn choose(cat: &RuntimeCatalogue, input: Option<&ChoiceInput>) -> Option<Choice> {
    let input = input?;
    let force = match input.force.as_deref() {
        None => None,
        Some(f) => Some(Backend::parse(f)?),
    };
    let gpu = input.gpu == Some(true);
    let row = cat
        .rows
        .iter()
        .find(|r| r.force == force && r.gpu.is_none_or(|g| g == gpu))?;
    let key = cat
        .runtimes
        .iter()
        .find(|r| r.os == input.os && r.arch == input.arch && r.backend == row.backend)
        .map(|r| r.key.clone());
    Some(Choice {
        row_id: row.id.clone(),
        backend: row.backend,
        key,
    })
}

/// Replaces the `@role` and `@role~text` references of `template` with the paths of the model's
/// files (`files`: each file with where it is).
pub fn resolve_args(
    template: &[String],
    files: &[(ModelFile, PathBuf)],
) -> Result<Vec<String>, String> {
    template
        .iter()
        .map(|arg| {
            let Some(spec) = arg.strip_prefix('@') else {
                return Ok(arg.clone());
            };
            let (role, hint) = spec.split_once('~').unwrap_or((spec, ""));
            let found: Vec<&(ModelFile, PathBuf)> = files
                .iter()
                .filter(|(f, _)| f.role == role && f.name.contains(hint))
                .collect();
            match found.as_slice() {
                [(_, path)] => Ok(path.to_string_lossy().into_owned()),
                [] => Err(format!("the model has no {spec} file")),
                _ => Err(format!("the model has several {spec} files")),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recommend::catalogue;

    const CASES: &str = include_str!("../../../../../tests/fixtures/ai-runtime-cases.json");

    #[test]
    fn the_embedded_file_parses_and_agrees_with_the_model_catalogue() {
        let cat = parse_runtimes(RUNTIMES_JSON).expect("ai-runtimes.json parses");
        assert_eq!(runtime_catalogue(), &cat);
        assert_eq!(cat.runtimes.len(), 4);
        assert!(cat
            .release
            .commit
            .starts_with(cat.release.tag.rsplit('-').next().unwrap()));
        let models = catalogue();
        for rt in &cat.runtimes {
            assert!(
                rt.url.ends_with(&format!(
                    "/releases/download/{}/{}",
                    cat.release.tag, rt.name
                )),
                "{} is pinned to the release",
                rt.key
            );
            let exe = if rt.os == "windows" { ".exe" } else { "" };
            assert_eq!(rt.server, format!("sd-server{exe}"));
            assert_eq!(rt.cli, format!("sd-cli{exe}"));
            assert!(rt.verified.iter().all(|k| rt.supports.contains(k)));
            for key in &rt.supports {
                let m = models
                    .model(key)
                    .unwrap_or_else(|| panic!("{key} is a model"));
                assert!(m.desktop(), "{key} runs on the desktop");
                // Every supported model has a profile whose references find exactly its files.
                let family = crate::json::parse(crate::recommend::CATALOGUE_JSON)
                    .unwrap()
                    .get("models")
                    .and_then(Value::as_array)
                    .unwrap()
                    .iter()
                    .find(|v| v.get("key").and_then(Value::as_str) == Some(key))
                    .and_then(|v| v.get("family").and_then(Value::as_str).map(str::to_string))
                    .unwrap();
                let p = cat
                    .profile(&family)
                    .unwrap_or_else(|| panic!("{family} profile"));
                let files: Vec<(ModelFile, PathBuf)> = m
                    .files
                    .iter()
                    .map(|f| (f.clone(), PathBuf::from(format!("/m/{}", f.sha256))))
                    .collect();
                resolve_args(&p.load, &files).unwrap_or_else(|e| panic!("{key}: {e}"));
                for (kind, c) in &p.controls {
                    resolve_args(&c.load, &files).unwrap_or_else(|e| panic!("{key} {kind}: {e}"));
                }
            }
        }
        let mut keys: Vec<&str> = cat.runtimes.iter().map(|r| r.key.as_str()).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), cat.runtimes.len(), "unique keys");
    }

    #[test]
    fn shared_cases_give_the_same_answers_as_the_interface() {
        // tests/fixtures/ai-runtime-cases.json, also read by tests/ai-runtimes.test.ts.
        let cat = runtime_catalogue();
        let cases = crate::json::parse(CASES).expect("cases parse");
        let cases = cases.as_array().expect("an array");
        assert!(cases.len() >= 10);
        for case in cases {
            let input = case.get("input").and_then(ChoiceInput::from_json);
            let got = choose(cat, input.as_ref());
            let expect = case.get("expect").expect("expect");
            let label = case.get("input").map(Value::to_json).unwrap_or_default();
            if expect.is_null() {
                assert_eq!(got, None, "{label}");
                continue;
            }
            let got = got.unwrap_or_else(|| panic!("{label}: a choice was expected"));
            assert_eq!(
                Some(got.row_id.as_str()),
                expect.get("rowId").and_then(Value::as_str),
                "{label}"
            );
            assert_eq!(
                Some(got.backend.name()),
                expect.get("backend").and_then(Value::as_str),
                "{label}"
            );
            assert_eq!(
                got.key.as_deref(),
                expect.get("key").and_then(Value::as_str),
                "{label}"
            );
        }
    }

    #[test]
    fn references_resolve_by_role_and_name() {
        let file = |role: &str, name: &str| ModelFile {
            role: role.into(),
            name: name.into(),
            bytes: 1,
            sha256: "0".repeat(64),
        };
        let files = vec![
            (file("transformer", "m.safetensors"), PathBuf::from("/b/1")),
            (
                file("controlnet", "cn_tile.safetensors"),
                PathBuf::from("/b/2"),
            ),
            (
                file("controlnet", "cn_depth.safetensors"),
                PathBuf::from("/b/3"),
            ),
        ];
        let t = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            resolve_args(
                &t(&["-m", "@transformer", "--control-net", "@controlnet~depth"]),
                &files
            )
            .unwrap(),
            ["-m", "/b/1", "--control-net", "/b/3"]
        );
        assert!(resolve_args(&t(&["@controlnet"]), &files)
            .unwrap_err()
            .contains("several"));
        assert!(resolve_args(&t(&["@vae"]), &files)
            .unwrap_err()
            .contains("no vae"));
    }
}

//! The AI runtime's test setup shared by `tests/ai.rs` (X3b) and `tests/ai_post.rs` (X3c): a
//! server whose runtime catalogue's build for this system is the fake `rt-fake-sd`, already
//! installed, with catalogue models "downloaded" (any bytes: the fake reads no weights).

use super::TestServer;
use rt_app::ai::catalogue;
use rt_app::ai::download::Downloader;
use rt_app::json;
use rt_app::server::Options;
use rt_app::sha256::{hex, Sha256};
use std::path::{Path, PathBuf};

pub const FAKE: &str = env!("CARGO_BIN_EXE_rt-fake-sd");
pub const EXE: &str = std::env::consts::EXE_SUFFIX;
/// The fake's SHA-256 does not matter where it is put in place by hand: any pinned value.
pub const PLACED: &str = "1111111111111111111111111111111111111111111111111111111111111111";

pub fn sha(d: &[u8]) -> String {
    hex(&Sha256::digest(d))
}

pub fn server_name() -> String {
    format!("sd-server{EXE}")
}

/// A catalogue whose CPU build for this system is the fake at `url` (and a Vulkan build that is
/// never installed, and one for another system), with the real choice rows and profiles.
pub fn override_json(url: &str, bytes: u64, sha256: &str) -> String {
    let real = json::parse(catalogue::RUNTIMES_JSON).unwrap();
    let keys = real.get("runtimes").unwrap().as_array().unwrap()[0]
        .get("supports")
        .unwrap()
        .to_json();
    let rt = |key: &str, os: &str, backend: &str, url: &str, bytes: u64, sha: &str| {
        json::Object::new()
            .str("key", key)
            .str("os", os)
            .str("arch", std::env::consts::ARCH)
            .str("backend", backend)
            .str("name", &format!("{key}.zip"))
            .str("url", url)
            .num("bytes", bytes as f64)
            .str("sha256", sha)
            .raw(
                "archive",
                &json::Object::new()
                    .str("format", "zip")
                    .str("server", &server_name())
                    .str("cli", &server_name())
                    .build(),
            )
            .raw("supports", &keys)
            .raw("verified", "[]")
            .build()
    };
    json::Object::new()
        .num("schema", 1.0)
        .raw("release", &real.get("release").unwrap().to_json())
        .raw(
            "runtimes",
            &json::array([
                rt("TEST_CPU", std::env::consts::OS, "CPU", url, bytes, sha256),
                rt(
                    "TEST_VULKAN",
                    std::env::consts::OS,
                    "VULKAN",
                    "http://127.0.0.1:9/none.zip",
                    1,
                    &"2".repeat(64),
                ),
                rt(
                    "TEST_OTHER",
                    "plan9",
                    "CPU",
                    "http://127.0.0.1:9/other.zip",
                    1,
                    &"3".repeat(64),
                ),
            ]),
        )
        .raw("choice", &real.get("choice").unwrap().to_json())
        .raw("profiles", &real.get("profiles").unwrap().to_json())
        .build()
}

/// Server options that put the catalogue `override_json` in place of the embedded one, with a
/// downloader that may use `http://` (the local `FileServer`).
pub fn with_catalogue(text: &str) -> Options {
    Options {
        ai_runtimes: Some((
            catalogue::parse_runtimes_allowing_http(text).unwrap(),
            Downloader {
                allow_http: true,
                ..Downloader::system()
            },
        )),
        ..Options::default()
    }
}

pub fn link_or_copy(from: &str, to: &Path) {
    if std::fs::hard_link(from, to).is_err() {
        std::fs::copy(from, to).unwrap();
    }
}

/// Puts the fake in place as the installed `TEST_CPU`, as an unpacked archive would be.
pub fn place_fake(data: &Path) -> PathBuf {
    let dir = data.join("ai/runtimes").join(PLACED);
    std::fs::create_dir_all(&dir).unwrap();
    link_or_copy(FAKE, &dir.join(server_name()));
    std::fs::write(
        dir.join("repackshot-runtime.json"),
        format!("{{\"key\":\"TEST_CPU\",\"sha256\":\"{PLACED}\"}}"),
    )
    .unwrap();
    dir
}

/// The blobs of a catalogue model (any bytes: the fake reads no weights), so it is "downloaded".
pub fn place_model(data: &Path, key: &str) {
    let blobs = data.join("models").join("blobs");
    std::fs::create_dir_all(&blobs).unwrap();
    for f in &rt_app::recommend::catalogue().model(key).unwrap().files {
        std::fs::write(blobs.join(&f.sha256), b"fake weights").unwrap();
    }
}

pub fn blob(data: &Path, key: &str, role: &str, hint: &str) -> String {
    let f = rt_app::recommend::catalogue()
        .model(key)
        .unwrap()
        .files
        .iter()
        .find(|f| f.role == role && f.name.contains(hint))
        .unwrap()
        .clone();
    data.join("models")
        .join("blobs")
        .join(f.sha256)
        .to_string_lossy()
        .into_owned()
}

/// A server whose runtime is the fake, already installed, with these models downloaded.
pub fn ready(name: &str, models: &[&str]) -> (TestServer, PathBuf, PathBuf) {
    let models: Vec<String> = models.iter().map(|s| s.to_string()).collect();
    let options = with_catalogue(&override_json("http://127.0.0.1:9/fake.zip", 1, PLACED));
    let t = TestServer::start_with_options(name, 1, options, |data| {
        place_fake(data);
        for m in &models {
            place_model(data, m);
        }
    });
    let data = t.dir.join("data");
    let rt = data.join("ai/runtimes").join(PLACED);
    (t, data, rt)
}

//! A server on a free port with its own folders, and a client that speaks to it.

#![allow(dead_code)]

use rt_app::client::{self, Reply};
use rt_app::paths::Paths;
use rt_app::server::Server;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

pub const TOKEN: &str = "00112233445566778899aabbccddeeff";

pub fn temp_dir(name: &str) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "rt-app-it-{name}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub struct TestServer {
    pub server: Server,
    pub dir: PathBuf,
}

impl TestServer {
    pub fn start(name: &str, threads: usize) -> TestServer {
        TestServer::start_with(name, threads, |_| {})
    }

    /// Starts after `setup` has prepared the data folder (tests/ai.rs: a runtime catalogue
    /// override, an installed runtime, model blobs).
    pub fn start_with(
        name: &str,
        threads: usize,
        setup: impl FnOnce(&std::path::Path),
    ) -> TestServer {
        let dir = temp_dir(name);
        std::fs::create_dir_all(dir.join("app/engine")).unwrap();
        std::fs::write(
            dir.join("app/index.html"),
            "<!doctype html><title>Repackshot</title>",
        )
        .unwrap();
        std::fs::write(dir.join("app/engine/rt.wasm"), b"\0asm\x01\0\0\0abcdefgh").unwrap();
        std::fs::write(dir.join("outside.txt"), "secret").unwrap();
        let paths = Paths {
            exe_dir: dir.clone(),
            app_dir: dir.join("app"),
            data_dir: dir.join("data"),
            portable: false,
        };
        std::fs::create_dir_all(&paths.data_dir).unwrap();
        setup(&paths.data_dir);
        let server = Server::start(paths, 0, TOKEN.into(), threads).unwrap();
        TestServer { server, dir }
    }

    pub fn port(&self) -> u16 {
        self.server.port()
    }

    pub fn raw(&self, method: &str, target: &str, headers: &[(&str, &str)], body: &[u8]) -> Reply {
        client::request(
            self.port(),
            method,
            target,
            headers,
            body,
            Duration::from_secs(120),
        )
        .unwrap_or_else(|e| panic!("{method} {target}: {e}"))
    }

    /// An API call with the token.
    pub fn api(&self, method: &str, target: &str, body: &[u8]) -> Reply {
        self.raw(method, target, &[("X-Repackshot-Token", TOKEN)], body)
    }

    pub fn json(&self, method: &str, target: &str, body: &[u8]) -> rt_app::json::Value {
        let r = self.api(method, target, body);
        rt_app::json::parse(&r.text())
            .unwrap_or_else(|e| panic!("{method} {target}: {e}: {}", r.text()))
    }
}

/// FNV-1a over the little-endian bytes of every float (the hash of rt-core's pinned tests).
pub fn fnv1a(values: &[f32]) -> u32 {
    values
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .fold(0x811c_9dc5u32, |hash, byte| {
            (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
        })
}

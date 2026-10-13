//! The port, stable per data folder (phase P3e). The window's page lives at
//! `http://127.0.0.1:<port>`, and the port is part of its origin: a new port at every launch would
//! be a new origin every time (whatever a window keeps by origin, its zoom, its permissions, would
//! start again). So the launcher remembers its port in `<data>/launcher.json` (`{"port": N}`),
//! uses it again at the next start when it is free, picks a new free one only when it is taken
//! (and remembers that one), and never changes it otherwise. `--port N` uses N and remembers
//! nothing.

use crate::json::{self, Value};
use crate::paths::Paths;
use crate::server::Server;
use std::io;
use std::path::{Path, PathBuf};

/// The file in the data folder.
pub fn file(paths: &Paths) -> PathBuf {
    paths.data_dir.join("launcher.json")
}

/// The remembered port, when there is a valid one (1024 to 65535).
pub fn remembered(path: &Path) -> Option<u16> {
    let text = std::fs::read_to_string(path).ok()?;
    let n = json::parse(&text)
        .ok()?
        .get("port")
        .and_then(Value::as_f64)?;
    (n.fract() == 0.0 && (1024.0..=65535.0).contains(&n)).then_some(n as u16)
}

/// Remembers `port` (atomically: a cut write never leaves half a file).
pub fn remember(path: &Path, port: u16) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = json::Object::new().num("port", f64::from(port)).build();
    crate::appdata::write_atomic(path, text.as_bytes())
}

/// Starts the server on the data folder's port: `requested` when it is not 0 (`--port`); else the
/// remembered one when it is free; else a new free port, which is remembered.
pub fn start(paths: &Paths, requested: u16, token: String, threads: usize) -> io::Result<Server> {
    if requested != 0 {
        return Server::start(paths.clone(), requested, token, threads);
    }
    let path = file(paths);
    if let Some(port) = remembered(&path) {
        match Server::start(paths.clone(), port, token.clone(), threads) {
            Ok(server) => return Ok(server),
            Err(e) => crate::log!("port {port} is taken ({e}): another one"),
        }
    }
    let server = Server::start(paths.clone(), 0, token, threads)?;
    if let Err(e) = remember(&path, server.port()) {
        crate::log!("cannot remember the port in {}: {e}", path.display());
    }
    Ok(server)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_valid_port_is_remembered() {
        let dir = crate::test_dir("port-file");
        let path = dir.join("launcher.json");
        assert_eq!(remembered(&path), None);
        remember(&path, 41234).unwrap();
        assert_eq!(remembered(&path), Some(41234));
        for bad in [
            "{}",
            "{\"port\":80}",
            "{\"port\":70000}",
            "{\"port\":4123.5}",
            "{\"port\":\"x\"}",
            "nope",
        ] {
            std::fs::write(&path, bad).unwrap();
            assert_eq!(remembered(&path), None, "{bad}");
        }
    }
}

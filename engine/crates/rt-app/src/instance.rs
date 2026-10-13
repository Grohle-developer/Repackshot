//! One launcher per data folder: `<data>/instance.json` holds the running one's port, token and
//! process id. A second launch that finds it alive (it answers `/api/info` with the token) opens
//! another window to it and exits. The file is readable by its owner only on Unix; on Windows
//! the data folder is in the user's own profile.

use crate::json::{self, Value};
use std::path::Path;
use std::time::Duration;

/// A running launcher.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Instance {
    /// Its port.
    pub port: u16,
    /// Its token.
    pub token: String,
    /// Its process id.
    pub pid: u32,
}

impl Instance {
    /// The window URL.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/#token={}", self.port, self.token)
    }
}

/// Reads `instance.json`.
pub fn read(path: &Path) -> Option<Instance> {
    let v = json::parse(&std::fs::read_to_string(path).ok()?).ok()?;
    let num = |k: &str| v.get(k).and_then(Value::as_f64).filter(|n| *n >= 0.0);
    let token = v.get("token")?.as_str()?.to_string();
    if !crate::token::is_well_formed(&token) {
        return None;
    }
    Some(Instance {
        port: u16::try_from(num("port")? as u64).ok()?,
        token,
        pid: num("pid")? as u32,
    })
}

/// Writes `instance.json`.
pub fn write(path: &Path, i: &Instance) -> std::io::Result<()> {
    let body = json::Object::new()
        .num("port", f64::from(i.port))
        .str("token", &i.token)
        .num("pid", f64::from(i.pid))
        .build();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options.open(path)?.write_all(body.as_bytes())
}

/// Removes `instance.json` if it is still this process's.
pub fn remove_if_ours(path: &Path, pid: u32) {
    if read(path).is_some_and(|i| i.pid == pid) {
        let _ = std::fs::remove_file(path);
    }
}

/// True when the instance answers `/api/info` with its token.
pub fn alive(i: &Instance) -> bool {
    crate::client::request(
        i.port,
        "GET",
        "/api/info",
        &[("X-Repackshot-Token", &i.token)],
        &[],
        Duration::from_secs(2),
    )
    .is_ok_and(|r| r.status == 200 && r.text().contains("\"app\":\"repackshot\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_ownership() {
        let dir = crate::test_dir("instance");
        let path = dir.join("instance.json");
        assert_eq!(read(&path), None);
        let i = Instance {
            port: 51234,
            token: "0123456789abcdef0123456789abcdef".into(),
            pid: 42,
        };
        write(&path, &i).unwrap();
        assert_eq!(read(&path), Some(i.clone()));
        assert_eq!(
            i.url(),
            "http://127.0.0.1:51234/#token=0123456789abcdef0123456789abcdef"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        remove_if_ours(&path, 7);
        assert!(path.exists(), "another process's file stays");
        remove_if_ours(&path, 42);
        assert!(!path.exists());
        std::fs::write(&path, r#"{"port":1,"token":"short","pid":1}"#).unwrap();
        assert_eq!(read(&path), None);
        // Nothing listens there: not alive.
        assert!(!alive(&Instance {
            port: 1,
            token: i.token,
            pid: 1
        }));
    }
}

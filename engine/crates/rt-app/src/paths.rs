//! Where things are: the interface (`app/` next to the executable), the data folder and, in it,
//! the browser profile, the models, the logs and the results.
//!
//! * Windows: `%LOCALAPPDATA%\Repackshot`.
//! * Linux and other Unix systems: `$XDG_DATA_HOME/repackshot`, else `~/.local/share/repackshot`.
//! * **Portable mode**: a file `portable.txt` next to the executable puts everything in `data/`
//!   next to it, the browser profile included, so the folder can be carried around with its
//!   settings and models.
//! * `--data-dir` overrides all of that, `--app-dir` the interface folder.

use std::path::{Path, PathBuf};

/// The folders the launcher uses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Paths {
    /// The folder of the executable.
    pub exe_dir: PathBuf,
    /// The interface (Vite's `dist/`).
    pub app_dir: PathBuf,
    /// The data folder.
    pub data_dir: PathBuf,
    /// True when `portable.txt` put the data next to the executable.
    pub portable: bool,
}

/// The environment the data folder depends on (passed in, so tests do not touch the real one).
#[derive(Clone, Debug, Default)]
pub struct Env {
    /// `%LOCALAPPDATA%` (Windows).
    pub local_app_data: Option<PathBuf>,
    /// `%USERPROFILE%` (Windows).
    pub user_profile: Option<PathBuf>,
    /// `$XDG_DATA_HOME`.
    pub xdg_data_home: Option<PathBuf>,
    /// `$HOME`.
    pub home: Option<PathBuf>,
}

impl Env {
    /// The real environment.
    pub fn current() -> Env {
        let var = |name: &str| {
            std::env::var_os(name)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
        };
        Env {
            local_app_data: var("LOCALAPPDATA"),
            user_profile: var("USERPROFILE"),
            xdg_data_home: var("XDG_DATA_HOME").filter(|p| p.is_absolute()),
            home: var("HOME"),
        }
    }
}

/// The data folder of an installed (not portable) launcher, or `None` when the environment does
/// not say where the user's data goes.
pub fn default_data_dir(env: &Env, windows: bool) -> Option<PathBuf> {
    if windows {
        env.local_app_data
            .clone()
            .or_else(|| {
                env.user_profile
                    .as_ref()
                    .map(|p| p.join("AppData").join("Local"))
            })
            .map(|p| p.join("Repackshot"))
    } else {
        env.xdg_data_home
            .clone()
            .or_else(|| env.home.as_ref().map(|h| h.join(".local").join("share")))
            .map(|p| p.join("repackshot"))
    }
}

/// Works out the folders from the executable's folder, the overrides and the environment.
pub fn resolve(
    exe_dir: &Path,
    data_override: Option<&Path>,
    app_override: Option<&Path>,
    env: &Env,
) -> Result<Paths, String> {
    let portable = exe_dir.join("portable.txt").is_file();
    let data_dir = match data_override {
        Some(d) => d.to_path_buf(),
        None if portable => exe_dir.join("data"),
        None => default_data_dir(env, cfg!(windows)).ok_or(
            "cannot tell where to keep the data: set LOCALAPPDATA or HOME, or pass --data-dir",
        )?,
    };
    Ok(Paths {
        exe_dir: exe_dir.to_path_buf(),
        app_dir: app_override.map_or_else(|| exe_dir.join("app"), Path::to_path_buf),
        data_dir,
        portable: portable && data_override.is_none(),
    })
}

impl Paths {
    /// The browser profile of the app window.
    pub fn browser_profile(&self) -> PathBuf {
        self.data_dir.join("browser-profile")
    }

    /// The model store.
    pub fn models(&self) -> PathBuf {
        self.data_dir.join("models")
    }

    /// The log files.
    pub fn logs(&self) -> PathBuf {
        self.data_dir.join("logs")
    }

    /// Rendered images kept by the application.
    pub fn results(&self) -> PathBuf {
        self.data_dir.join("results")
    }

    /// What the installer chose to download (`pending-models.json`).
    pub fn pending_models(&self) -> PathBuf {
        self.data_dir.join("pending-models.json")
    }

    /// The running instance (`instance.json`).
    pub fn instance(&self) -> PathBuf {
        self.data_dir.join("instance.json")
    }
}

/// The folder of the running executable.
pub fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot find the executable: {e}"))?;
    let exe = exe.canonicalize().map(simplify).unwrap_or(exe);
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "the executable has no folder".into())
}

/// Removes the `\\?\` prefix Windows' `canonicalize` adds (`\\?\C:\x` is `C:\x`,
/// `\\?\UNC\server\share` is `\\server\share`), so the paths shown to the person and handed
/// to Explorer are ordinary ones. Other paths are returned unchanged.
pub fn simplify(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path;
    };
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest)
            if rest.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
                && rest.as_bytes().get(1..3) == Some(br":\") =>
        {
            PathBuf::from(rest)
        }
        _ => path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_folders_per_system() {
        let env = Env {
            local_app_data: Some("C:/Users/a/AppData/Local".into()),
            user_profile: Some("C:/Users/a".into()),
            xdg_data_home: None,
            home: Some("/home/a".into()),
        };
        assert_eq!(
            default_data_dir(&env, true),
            Some(PathBuf::from("C:/Users/a/AppData/Local/Repackshot"))
        );
        assert_eq!(
            default_data_dir(&env, false),
            Some(PathBuf::from("/home/a/.local/share/repackshot"))
        );
        let xdg = Env {
            xdg_data_home: Some("/data".into()),
            ..env.clone()
        };
        assert_eq!(
            default_data_dir(&xdg, false),
            Some(PathBuf::from("/data/repackshot"))
        );
        let profile_only = Env {
            local_app_data: None,
            ..env
        };
        assert_eq!(
            default_data_dir(&profile_only, true),
            Some(PathBuf::from("C:/Users/a/AppData/Local/Repackshot"))
        );
        assert_eq!(default_data_dir(&Env::default(), false), None);
    }

    #[test]
    fn verbatim_prefixes_are_removed() {
        assert_eq!(
            simplify(PathBuf::from(r"\\?\C:\Users\a\Repackshot")),
            PathBuf::from(r"C:\Users\a\Repackshot")
        );
        assert_eq!(
            simplify(PathBuf::from(r"\\?\UNC\server\share\x")),
            PathBuf::from(r"\\server\share\x")
        );
        assert_eq!(
            simplify(PathBuf::from(r"\\?\Volume{123}\x")),
            PathBuf::from(r"\\?\Volume{123}\x")
        );
        assert_eq!(simplify(PathBuf::from("/home/a")), PathBuf::from("/home/a"));
        // Never a panic on a short or non-ASCII path.
        for odd in [r"\\?\", r"\\?\C", r"\\?\Cé\x", r"\\?\é:\x"] {
            assert_eq!(simplify(PathBuf::from(odd)), PathBuf::from(odd));
        }
    }

    #[test]
    fn portable_mode_keeps_everything_next_to_the_executable() {
        let dir = crate::test_dir("paths-portable");
        let env = Env {
            home: Some("/home/a".into()),
            local_app_data: Some("/lad".into()),
            ..Env::default()
        };
        let installed = resolve(&dir, None, None, &env).unwrap();
        assert!(!installed.portable);
        assert_eq!(installed.app_dir, dir.join("app"));
        std::fs::write(dir.join("portable.txt"), "").unwrap();
        let portable = resolve(&dir, None, None, &env).unwrap();
        assert!(portable.portable);
        assert_eq!(portable.data_dir, dir.join("data"));
        assert_eq!(
            portable.browser_profile(),
            dir.join("data").join("browser-profile")
        );
        let forced = resolve(&dir, Some(Path::new("/x")), Some(Path::new("/ui")), &env).unwrap();
        assert!(!forced.portable);
        assert_eq!(forced.data_dir, PathBuf::from("/x"));
        assert_eq!(forced.app_dir, PathBuf::from("/ui"));
    }
}

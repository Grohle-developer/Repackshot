//! Windows builds: the icon and the version information of `repackshot.exe`, compiled by
//! mingw-w64's `windres` into an object file linked into the binary. Only when the target is
//! Windows (GNU) and the tool is there; otherwise a warning, never a failure. The link leaves the
//! time out of the PE header, so a release build is reproducible.
//!
//! The icon comes from `REPACKSHOT_ICON` (`packaging/release.mjs` generates it from
//! `docs/media/logo.svg`); without it the executable gets the version information only.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=REPACKSHOT_ICON");
    println!("cargo:rerun-if-env-changed=WINDRES");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let package = manifest.join("../../../package.json");
    println!("cargo:rerun-if-changed={}", package.display());
    let version = fs::read_to_string(&package)
        .ok()
        .and_then(|t| {
            let i = t.find("\"version\"")?;
            let rest = &t[i + 9..];
            let start = rest.find('"')? + 1;
            let end = start + rest[start..].find('"')?;
            Some(rest[start..end].to_string())
        })
        .unwrap_or_else(|| env::var("CARGO_PKG_VERSION").unwrap_or_default());
    let mut numbers: Vec<u16> = version
        .split(['.', '-', '+'])
        .take(3)
        .map(|p| p.parse().unwrap_or(0))
        .collect();
    numbers.resize(4, 0);
    let numeric = numbers
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(",");

    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu") {
        // The same sources give the same .exe: no link time in the PE header.
        println!("cargo:rustc-link-arg-bins=-Wl,--no-insert-timestamp");
    }
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:warning=repackshot.exe: icon and version need mingw-w64 windres; skipped for MSVC");
        return;
    }
    let windres = env::var("WINDRES").ok().unwrap_or_else(|| {
        let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
        format!("{arch}-w64-mingw32-windres")
    });
    let candidates = [windres, "windres".to_string()];
    let Some(tool) = candidates.iter().find(|t| {
        Command::new(t)
            .arg("--version")
            .output()
            .is_ok_and(|o| o.status.success())
    }) else {
        println!("cargo:warning=repackshot.exe: windres not found; no icon or version information");
        return;
    };

    let icon = env::var_os("REPACKSHOT_ICON").map(PathBuf::from);
    let icon_line = match &icon {
        Some(p) if p.is_file() => {
            println!("cargo:rerun-if-changed={}", p.display());
            format!(
                "1 ICON \"{}\"\n",
                p.display().to_string().replace('\\', "/")
            )
        }
        Some(p) => {
            println!(
                "cargo:warning=REPACKSHOT_ICON {} does not exist; no icon",
                p.display()
            );
            String::new()
        }
        None => String::new(),
    };
    let rc = format!(
        "{icon_line}1 VERSIONINFO
FILEVERSION {numeric}
PRODUCTVERSION {numeric}
FILEFLAGSMASK 0x3f
FILEFLAGS 0x0
FILEOS 0x40004
FILETYPE 0x1
FILESUBTYPE 0x0
BEGIN
  BLOCK \"StringFileInfo\"
  BEGIN
    BLOCK \"040904b0\"
    BEGIN
      VALUE \"CompanyName\", \"Grohle\"
      VALUE \"FileDescription\", \"Repackshot\"
      VALUE \"FileVersion\", \"{version}\"
      VALUE \"InternalName\", \"repackshot\"
      VALUE \"LegalCopyright\", \"Copyright 2026 Grohle. PolyForm Noncommercial 1.0.0\"
      VALUE \"OriginalFilename\", \"repackshot.exe\"
      VALUE \"ProductName\", \"Repackshot\"
      VALUE \"ProductVersion\", \"{version}\"
    END
  END
  BLOCK \"VarFileInfo\"
  BEGIN
    VALUE \"Translation\", 0x409, 1200
  END
END
"
    );
    let out = PathBuf::from(env::var("OUT_DIR").unwrap_or_default());
    let rc_path = out.join("repackshot.rc");
    let obj = out.join("repackshot-res.o");
    if let Err(e) = fs::write(&rc_path, rc) {
        println!("cargo:warning=repackshot.exe: cannot write the resource script: {e}");
        return;
    }
    let status = Command::new(tool)
        .arg("--input-format=rc")
        .arg("--output-format=coff")
        .arg("-i")
        .arg(&rc_path)
        .arg("-o")
        .arg(&obj)
        .status();
    match status {
        Ok(s) if s.success() => println!("cargo:rustc-link-arg-bins={}", obj.display()),
        other => println!(
            "cargo:warning=repackshot.exe: {tool} failed ({other:?}); no icon or version information"
        ),
    }
}

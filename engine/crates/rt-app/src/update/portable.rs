//! A portable copy updating itself. The new package is unpacked into `<exe folder>/update-<tag>/`
//! first, all of it; only when every file is there does anything of the running copy move:
//!
//! 1. every file and folder of the package (the executable last) takes the place of the one with
//!    its name, which is renamed `<name>.old` (`repackshot.exe` → `repackshot.old.exe`, `app` →
//!    `app.old`). A running executable can be renamed on Windows and on Linux, though not
//!    overwritten, and the running copy goes on from the renamed file;
//! 2. `data/` and `portable.txt` are never touched: the person's models, settings and the mark
//!    that makes the copy portable stay where they are;
//! 3. if any step fails, the steps already done are undone in reverse and the old files are where
//!    they were;
//! 4. the names to delete are written to `update.json` first, and the next start (the new
//!    version) deletes them, and the `update-*` folders, as it starts.

use super::feed::Kind;
use crate::ai::zip;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Of the package, these stay as they are.
const KEPT: [&str; 2] = ["data", "portable.txt"];

/// The journal of a swap: what the next start deletes.
pub const JOURNAL: &str = "update.json";

/// `repackshot.exe` → `repackshot.old.exe`, `app` → `app.old`, `LICENSE` → `LICENSE.old`.
pub fn old_name(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}.old.{ext}"),
        _ => format!("{name}.old"),
    }
}

/// `update-<tag>`: where a package is unpacked.
pub fn update_dir_name(tag: &str) -> String {
    format!("update-{tag}")
}

fn plain(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'+'))
}

fn disk_full(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::StorageFull
}

/// Says "there is no room" in the one way the interface knows (`disk-full`), else with `what`.
fn describe(what: &str, e: &io::Error) -> String {
    if disk_full(e) {
        format!("not enough space on the disk ({what}: {e})")
    } else {
        format!("{what}: {e}")
    }
}

/// Unpacks `archive` (the package of `kind`) into `dest`, which must not exist. A zip is read by
/// this crate's own reader; a tar.gz by the system's `tar` after its list of names was checked
/// (no absolute or climbing names, no links, nothing outside plain file names).
pub fn extract(kind: Kind, archive: &Path, dest: &Path, tar: Option<&Path>) -> Result<(), String> {
    if dest.exists() {
        return Err(format!("{} is there already", dest.display()));
    }
    let result = match kind {
        Kind::Setup => Err("the installer is run, not unpacked".to_string()),
        Kind::WindowsPortable => zip::extract(archive, dest, zip::Limits::default())
            .map(|_| ())
            .map_err(|e| match e {
                zip::ZipError::Io(io) => describe("writing the new version", &io),
                other => other.to_string(),
            }),
        Kind::LinuxPortable => match tar {
            Some(tar) => extract_tar(tar, archive, dest),
            None => Err("there is no tar on this computer to unpack the update with".into()),
        },
    };
    if result.is_err() {
        let _ = fs::remove_dir_all(dest);
    }
    result
}

/// Names that `tar` lists for an archive, or why not.
fn tar_list(tar: &Path, archive: &Path, verbose: bool) -> Result<Vec<String>, String> {
    let mut cmd = std::process::Command::new(tar);
    cmd.arg(if verbose { "-tvzf" } else { "-tzf" }).arg(archive);
    crate::process::no_window(&mut cmd);
    let ran = crate::process::output_any(cmd, Duration::from_secs(120))?;
    if !ran.success() {
        return Err(format!(
            "tar could not read the archive ({})",
            ran.exit_text()
        ));
    }
    Ok(ran.stdout.lines().map(str::to_string).collect())
}

fn extract_tar(tar: &Path, archive: &Path, dest: &Path) -> Result<(), String> {
    let names = tar_list(tar, archive, false)?;
    if names.is_empty() || names.len() > 4096 {
        return Err("the archive is empty or has too many entries".into());
    }
    for name in &names {
        zip::safe_components(name).map_err(|_| format!("unsafe name in the archive: {name:?}"))?;
    }
    // A link (symbolic `l`, hard `h`) or a device is not a file of the application.
    for line in tar_list(tar, archive, true)? {
        if !matches!(line.chars().next(), Some('-' | 'd')) {
            return Err(format!(
                "the archive holds something that is not a file: {line:?}"
            ));
        }
    }
    fs::create_dir_all(dest).map_err(|e| describe("creating the update folder", &e))?;
    let mut cmd = std::process::Command::new(tar);
    cmd.arg("-xzf")
        .arg(archive)
        .arg("--no-same-owner")
        .arg("-C")
        .arg(dest);
    crate::process::no_window(&mut cmd);
    let ran = crate::process::output_any(cmd, Duration::from_secs(300))?;
    if ran.success() {
        return Ok(());
    }
    let full = ran.stderr.contains("No space left") || ran.stderr.contains("not enough space");
    Err(if full {
        format!("not enough space on the disk (tar: {})", ran.exit_text())
    } else {
        format!("tar could not unpack the archive ({})", ran.exit_text())
    })
}

/// The folder that holds the package's files: `dest` itself, or the one folder inside it that
/// the archive wraps them in (`Repackshot-0.2.0/`). It must hold the executable and the interface.
pub fn package_root(dest: &Path, exe_name: &str) -> Result<PathBuf, String> {
    let entries: Vec<PathBuf> = fs::read_dir(dest)
        .map_err(|e| format!("{}: {e}", dest.display()))?
        .flatten()
        .map(|e| e.path())
        .collect();
    let root = match entries.as_slice() {
        [only] if only.is_dir() => only.clone(),
        _ => dest.to_path_buf(),
    };
    for (what, path) in [
        (exe_name.to_string(), root.join(exe_name)),
        (
            "app/index.html".to_string(),
            root.join("app").join("index.html"),
        ),
    ] {
        if !path.is_file() {
            return Err(format!("the package has no {what}"));
        }
    }
    if fs::metadata(root.join(exe_name)).map_or(true, |m| m.len() == 0) {
        return Err(format!("the package's {exe_name} is empty"));
    }
    Ok(root)
}

/// One step of the swap, to undo it.
struct Step {
    /// Where it came from.
    from: PathBuf,
    /// Where it went.
    to: PathBuf,
    /// Where what was there went, when something was.
    old: Option<PathBuf>,
}

fn remove_any(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// Undoes `done` in reverse: the new thing goes back to the package folder, the old one to its name.
fn roll_back(done: Vec<Step>) {
    for step in done.into_iter().rev() {
        let _ = fs::rename(&step.to, &step.from);
        if let Some(old) = step.old {
            let _ = fs::rename(&old, &step.to);
        }
    }
}

/// Puts the package at `root` in place of what is in `exe_dir`. `exe_name` is the executable's name
/// (it goes last, so that an error before it leaves the executable alone). Returns the new executable.
pub fn apply(exe_dir: &Path, root: &Path, exe_name: &str, tag: &str) -> Result<PathBuf, String> {
    apply_with(exe_dir, root, exe_name, tag, &|from, to| {
        fs::rename(from, to)
    })
}

/// [`apply`] with the rename it uses handed in (the tests make one of them fail).
fn apply_with(
    exe_dir: &Path,
    root: &Path,
    exe_name: &str,
    tag: &str,
    rename: &dyn Fn(&Path, &Path) -> io::Result<()>,
) -> Result<PathBuf, String> {
    let mut names: Vec<String> = fs::read_dir(root)
        .map_err(|e| format!("{}: {e}", root.display()))?
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !KEPT.contains(&n.as_str()))
        .collect();
    names.sort();
    if let Some(i) = names.iter().position(|n| n == exe_name) {
        let exe = names.remove(i);
        names.push(exe);
    } else {
        return Err(format!("the package has no {exe_name}"));
    }
    if let Some(bad) = names.iter().find(|n| !plain(n)) {
        return Err(format!("the package has an unusual name: {bad:?}"));
    }
    // What the next start deletes, before anything moves: a crash in the middle still leaves the list.
    write_journal(exe_dir, tag, names.iter().map(|n| old_name(n)))
        .map_err(|e| describe("writing update.json", &e))?;
    let mut done: Vec<Step> = Vec::new();
    for name in &names {
        let from = root.join(name);
        let to = exe_dir.join(name);
        let old_path = exe_dir.join(old_name(name));
        let mut old = None;
        let step = (|| -> io::Result<()> {
            if exists(&to) {
                // A leftover of an earlier update that could not be deleted.
                remove_any(&old_path)?;
                rename(&to, &old_path)?;
                old = Some(old_path.clone());
            }
            rename(&from, &to)
        })();
        match step {
            Ok(()) => done.push(Step { from, to, old }),
            Err(e) => {
                // The step that failed may have moved the old file already.
                if let Some(old) = old {
                    let _ = fs::rename(&old, &to);
                }
                let failed = describe(&format!("replacing {name}"), &e);
                roll_back(done);
                let _ = fs::remove_file(exe_dir.join(JOURNAL));
                return Err(failed);
            }
        }
    }
    Ok(exe_dir.join(exe_name))
}

fn write_journal(exe_dir: &Path, tag: &str, old: impl Iterator<Item = String>) -> io::Result<()> {
    let body = crate::json::Object::new()
        .str("tag", tag)
        .raw(
            "old",
            &crate::json::array(old.map(|n| crate::json::string(&n))),
        )
        .build();
    let path = exe_dir.join(JOURNAL);
    let tmp = exe_dir.join(format!("{JOURNAL}.tmp"));
    fs::write(&tmp, body)?;
    fs::rename(tmp, path)
}

/// What a clean-up did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Cleaned {
    /// Names deleted (old files and folders, `update-*` folders).
    pub removed: Vec<String>,
    /// Names that could not be deleted yet (an old executable still running); tried again later.
    pub kept: Vec<String>,
}

/// An `update-<version>` folder name.
fn is_update_dir(name: &str) -> bool {
    name.strip_prefix("update-")
        .is_some_and(|tag| super::feed::normalize_tag(tag).is_some())
}

/// Deletes what an earlier update left in the application's folder: the names of `update.json`
/// (the `.old` files and folders) and the `update-<version>` folders. What cannot be deleted yet
/// stays in the journal for the next try. Nothing else is touched.
pub fn cleanup(exe_dir: &Path) -> Cleaned {
    let mut out = Cleaned::default();
    let journal = exe_dir.join(JOURNAL);
    let listed: Vec<String> = fs::read_to_string(&journal)
        .ok()
        .and_then(|t| crate::json::parse(&t).ok())
        .and_then(|v| {
            v.get("old")
                .and_then(crate::json::Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(str::to_string))
                        .collect()
                })
        })
        .unwrap_or_default();
    for name in listed {
        // Only what an update makes: a plain name with `.old` in it, never the files that stay.
        if !plain(&name) || !(name.ends_with(".old") || name.contains(".old.")) {
            continue;
        }
        let path = exe_dir.join(&name);
        if !exists(&path) {
            continue;
        }
        match remove_any(&path) {
            Ok(()) => out.removed.push(name),
            Err(_) => out.kept.push(name),
        }
    }
    if let Ok(entries) = fs::read_dir(exe_dir) {
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if is_update_dir(&name) && entry.path().is_dir() {
                match fs::remove_dir_all(entry.path()) {
                    Ok(()) => out.removed.push(name),
                    Err(_) => out.kept.push(name),
                }
            }
        }
    }
    if out.kept.is_empty() {
        let _ = fs::remove_file(&journal);
    } else if journal.exists() {
        let old = out.kept.iter().filter(|n| !is_update_dir(n)).cloned();
        let _ = write_journal(exe_dir, "", old);
    }
    out.removed.sort();
    out.kept.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// An application folder of version "old" and an unpacked package of version "new".
    fn folders(name: &str) -> (PathBuf, PathBuf) {
        let dir = crate::test_dir(name);
        let exe_dir = dir.join("app-folder");
        write(&exe_dir.join("repackshot"), "old exe");
        write(&exe_dir.join("app/index.html"), "old ui");
        write(&exe_dir.join("app/old-only.js"), "old chunk");
        write(&exe_dir.join("LICENSE"), "old licence");
        write(&exe_dir.join("README.txt"), "old readme");
        write(&exe_dir.join("portable.txt"), "mine");
        write(&exe_dir.join("data/settings.json"), "{\"mine\":1}");
        let root = exe_dir.join("update-0.2.0/Repackshot-0.2.0");
        write(&root.join("repackshot"), "new exe");
        write(&root.join("app/index.html"), "new ui");
        write(&root.join("app/new-only.js"), "new chunk");
        write(&root.join("LICENSE"), "new licence");
        write(&root.join("README.txt"), "new readme");
        write(&root.join("portable.txt"), "the package's");
        write(&root.join("data/not-mine.json"), "no");
        (exe_dir, root)
    }

    #[test]
    fn old_names_keep_the_extension_last() {
        assert_eq!(old_name("repackshot"), "repackshot.old");
        assert_eq!(old_name("repackshot.exe"), "repackshot.old.exe");
        assert_eq!(old_name("app"), "app.old");
        assert_eq!(old_name("LICENSE"), "LICENSE.old");
        assert_eq!(
            old_name("THIRD-PARTY-NOTICES.txt"),
            "THIRD-PARTY-NOTICES.old.txt"
        );
        assert_eq!(old_name(".hidden"), ".hidden.old");
    }

    #[test]
    fn the_new_files_go_in_and_the_old_ones_are_renamed() {
        let (exe_dir, root) = folders("portable-swap");
        let exe = apply(&exe_dir, &root, "repackshot", "0.2.0").unwrap();
        assert_eq!(exe, exe_dir.join("repackshot"));
        // The new files are in place, the interface whole.
        assert_eq!(read(&exe_dir.join("repackshot")), "new exe");
        assert_eq!(read(&exe_dir.join("app/index.html")), "new ui");
        assert_eq!(read(&exe_dir.join("app/new-only.js")), "new chunk");
        assert!(!exe_dir.join("app/old-only.js").exists());
        assert_eq!(read(&exe_dir.join("LICENSE")), "new licence");
        // The old ones are beside them.
        assert_eq!(read(&exe_dir.join("repackshot.old")), "old exe");
        assert_eq!(read(&exe_dir.join("app.old/index.html")), "old ui");
        assert_eq!(read(&exe_dir.join("app.old/old-only.js")), "old chunk");
        assert_eq!(read(&exe_dir.join("LICENSE.old")), "old licence");
        assert_eq!(read(&exe_dir.join("README.old.txt")), "old readme");
        // The person's data and the portable mark are not touched.
        assert_eq!(read(&exe_dir.join("data/settings.json")), "{\"mine\":1}");
        assert!(!exe_dir.join("data/not-mine.json").exists());
        assert_eq!(read(&exe_dir.join("portable.txt")), "mine");
        // The journal lists what the next start deletes.
        let journal = crate::json::parse(&read(&exe_dir.join(JOURNAL))).unwrap();
        let listed: Vec<&str> = journal
            .get("old")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(
            listed,
            ["LICENSE.old", "README.old.txt", "app.old", "repackshot.old"]
        );
    }

    /// Everything under `dir` as (relative path, content), sorted.
    fn snapshot(dir: &Path) -> Vec<(String, String)> {
        fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
            for e in fs::read_dir(dir).unwrap().flatten() {
                let path = e.path();
                let rel = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                if path.is_dir() {
                    out.push((format!("{rel}/"), String::new()));
                    walk(base, &path, out);
                } else {
                    out.push((rel, fs::read_to_string(&path).unwrap()));
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, dir, &mut out);
        out.sort();
        out
    }

    #[test]
    fn a_failure_at_any_step_leaves_the_old_files_where_they_were() {
        use std::cell::Cell;
        // LICENSE, README.txt, app and the executable each take two renames: 8 in all.
        for failing in 1..=8 {
            let (exe_dir, root) = folders("portable-rollback");
            let before_app = snapshot(&exe_dir);
            let calls = Cell::new(0);
            let flaky = |from: &Path, to: &Path| {
                calls.set(calls.get() + 1);
                if calls.get() == failing {
                    Err(io::Error::other("injected"))
                } else {
                    fs::rename(from, to)
                }
            };
            let e = apply_with(&exe_dir, &root, "repackshot", "0.2.0", &flaky).unwrap_err();
            assert!(e.contains("injected"), "{failing}: {e}");
            // The application's folder is what it was, byte for byte (the package folder too, which
            // is part of it here: everything the swap moved is back).
            assert_eq!(
                snapshot(&exe_dir),
                before_app,
                "failing at rename {failing}"
            );
            assert!(!exe_dir.join(JOURNAL).exists());
        }
    }

    #[test]
    fn a_package_without_its_executable_changes_nothing() {
        let (exe_dir, root) = folders("portable-no-exe");
        fs::remove_file(root.join("repackshot")).unwrap();
        let before = snapshot(&exe_dir);
        let e = apply(&exe_dir, &root, "repackshot", "0.2.0").unwrap_err();
        assert!(e.contains("no repackshot"), "{e}");
        assert_eq!(snapshot(&exe_dir), before);
        // Nor does a package with a name that is not a plain one.
        let (exe_dir, root) = folders("portable-odd-name");
        write(&root.join("odd name.txt"), "x");
        let before = snapshot(&exe_dir);
        assert!(apply(&exe_dir, &root, "repackshot", "0.2.0")
            .unwrap_err()
            .contains("unusual name"));
        assert_eq!(snapshot(&exe_dir), before);
    }

    #[test]
    fn an_earlier_update_that_could_not_clean_up_does_not_block_the_next() {
        let (exe_dir, root) = folders("portable-leftover");
        // `repackshot.old` and `app.old` are still there from the update before.
        write(&exe_dir.join("repackshot.old"), "older exe");
        write(&exe_dir.join("app.old/stale.js"), "older chunk");
        apply(&exe_dir, &root, "repackshot", "0.3.0").unwrap();
        assert_eq!(read(&exe_dir.join("repackshot")), "new exe");
        assert_eq!(read(&exe_dir.join("repackshot.old")), "old exe");
        assert_eq!(read(&exe_dir.join("app.old/index.html")), "old ui");
        assert!(!exe_dir.join("app.old/stale.js").exists());
    }

    #[test]
    fn the_next_start_deletes_the_old_files_and_the_update_folders() {
        let (exe_dir, root) = folders("portable-cleanup");
        apply(&exe_dir, &root, "repackshot", "0.2.0").unwrap();
        // Something of the person's that merely looks alike stays.
        write(&exe_dir.join("notes.old.txt"), "mine");
        write(&exe_dir.join("update-notes/keep.txt"), "mine");
        let cleaned = cleanup(&exe_dir);
        assert_eq!(
            cleaned.removed,
            [
                "LICENSE.old",
                "README.old.txt",
                "app.old",
                "repackshot.old",
                "update-0.2.0"
            ]
        );
        assert!(cleaned.kept.is_empty());
        assert!(!exe_dir.join("repackshot.old").exists());
        assert!(!exe_dir.join("app.old").exists());
        assert!(!exe_dir.join("update-0.2.0").exists());
        assert!(!exe_dir.join(JOURNAL).exists());
        // The new version is untouched, and so is everything that is not an update's.
        assert_eq!(read(&exe_dir.join("repackshot")), "new exe");
        assert_eq!(read(&exe_dir.join("app/index.html")), "new ui");
        assert_eq!(read(&exe_dir.join("notes.old.txt")), "mine");
        assert_eq!(read(&exe_dir.join("update-notes/keep.txt")), "mine");
        assert_eq!(read(&exe_dir.join("data/settings.json")), "{\"mine\":1}");
        // Again: nothing to do.
        assert_eq!(cleanup(&exe_dir), Cleaned::default());
    }

    #[test]
    fn a_journal_cannot_name_files_outside_what_an_update_makes() {
        let dir = crate::test_dir("portable-journal");
        write(&dir.join("repackshot"), "exe");
        write(&dir.join("portable.txt"), "mine");
        write(&dir.join("data/x"), "mine");
        write(
            &dir.join(JOURNAL),
            r#"{"old":["repackshot","portable.txt","data","../outside","a/b.old",".old","x.old"]}"#,
        );
        write(&dir.join("x.old"), "removed: it is a plain .old name");
        let cleaned = cleanup(&dir);
        assert_eq!(cleaned.removed, ["x.old"]);
        assert_eq!(read(&dir.join("repackshot")), "exe");
        assert_eq!(read(&dir.join("portable.txt")), "mine");
        assert_eq!(read(&dir.join("data/x")), "mine");
        // A journal that is not JSON is ignored.
        write(&dir.join(JOURNAL), "not json");
        assert_eq!(cleanup(&dir), Cleaned::default());
    }

    #[test]
    fn the_package_root_is_the_wrapping_folder_or_the_folder_itself() {
        let dir = crate::test_dir("portable-root");
        let wrapped = dir.join("wrapped");
        write(&wrapped.join("Repackshot-0.2.0/repackshot"), "exe");
        write(&wrapped.join("Repackshot-0.2.0/app/index.html"), "ui");
        assert_eq!(
            package_root(&wrapped, "repackshot").unwrap(),
            wrapped.join("Repackshot-0.2.0")
        );
        let flat = dir.join("flat");
        write(&flat.join("repackshot"), "exe");
        write(&flat.join("app/index.html"), "ui");
        assert_eq!(package_root(&flat, "repackshot").unwrap(), flat);
        // No interface, no executable, an empty executable: not a package.
        write(&dir.join("a/Repackshot-0.2.0/repackshot"), "exe");
        assert!(package_root(&dir.join("a"), "repackshot")
            .unwrap_err()
            .contains("app/index.html"));
        assert!(package_root(&dir.join("a"), "repackshot.exe").is_err());
        write(&dir.join("b/repackshot"), "");
        write(&dir.join("b/app/index.html"), "ui");
        assert!(package_root(&dir.join("b"), "repackshot")
            .unwrap_err()
            .contains("empty"));
    }
}

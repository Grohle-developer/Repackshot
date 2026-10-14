//! What an update may download. The page names the files (`POST /api/update/install`), but the
//! launcher decides whether they are the ones: only `https://github.com/<owner>/<repo>/releases/
//! download/<tag>/<file>` of the repository the interface checks for new versions
//! (`src/data/update-feed.ts`, read from the same file when this crate is built, so the two cannot
//! differ), and only the package that replaces this kind of copy of the application, plus the
//! `SHA256SUMS.txt` of the same release.

/// The interface's feed constant, as TypeScript (the single place the repository is named).
const FEED_SOURCE: &str = include_str!("../../../../../src/data/update-feed.ts");

/// The packages `packaging/release.mjs` builds, named as `core/updates.ts` names them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `Repackshot-<v>-windows-x64-setup.exe`: the installer, for an installed Windows copy.
    Setup,
    /// `Repackshot-<v>-windows-x64-portable.zip`.
    WindowsPortable,
    /// `Repackshot-<v>-linux-x64-portable.tar.gz`.
    LinuxPortable,
}

impl Kind {
    /// The file name of this package for version `tag` (no leading `v`).
    pub fn package_name(self, tag: &str) -> String {
        let tail = match self {
            Kind::Setup => "windows-x64-setup.exe",
            Kind::WindowsPortable => "windows-x64-portable.zip",
            Kind::LinuxPortable => "linux-x64-portable.tar.gz",
        };
        format!("Repackshot-{tag}-{tail}")
    }

    /// The executable the package holds.
    pub fn exe_name(self) -> &'static str {
        match self {
            Kind::Setup | Kind::WindowsPortable => "repackshot.exe",
            Kind::LinuxPortable => "repackshot",
        }
    }

    /// A portable package is unpacked; the installer is run.
    pub fn portable(self) -> bool {
        self != Kind::Setup
    }
}

/// The name of the checksums file every release carries.
pub const SUMS_NAME: &str = "SHA256SUMS.txt";

/// Where releases are downloaded from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Feed {
    /// `https://github.com` (the tests: a local `http://127.0.0.1:<port>`).
    pub origin: String,
    /// The repository's owner.
    pub owner: String,
    /// The repository's name.
    pub repo: String,
}

fn plain(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// The text between the quotes after `key: '` in `text`.
fn quoted_after(text: &str, key: &str) -> Option<String> {
    let marker = format!("{key}: '");
    let start = text.find(&marker)? + marker.len();
    let end = text[start..].find('\'')?;
    Some(text[start..start + end].to_string())
}

impl Feed {
    /// The repository of `src/data/update-feed.ts` on GitHub.
    pub fn embedded() -> Feed {
        Feed::from_source(FEED_SOURCE, "https://github.com")
            .unwrap_or_else(|| panic!("src/data/update-feed.ts: no owner and repo"))
    }

    /// Reads `owner: '…', repo: '…'` of the feed constant.
    pub fn from_source(source: &str, origin: &str) -> Option<Feed> {
        // The constant's own line: the interface above it declares `owner: string`.
        let line = source.lines().find(|l| l.contains("UPDATE_FEED:"))?;
        let owner = quoted_after(line, "owner")?;
        let repo = quoted_after(line, "repo")?;
        (plain(&owner) && plain(&repo)).then(|| Feed {
            origin: origin.to_string(),
            owner,
            repo,
        })
    }

    /// `<origin>/<owner>/<repo>/releases/download/`.
    pub fn download_prefix(&self) -> String {
        format!(
            "{}/{}/{}/releases/download/",
            self.origin, self.owner, self.repo
        )
    }
}

/// What the page asked to install, checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    /// The version, without a leading `v`: `0.2.0`.
    pub tag: String,
    /// The package's file name.
    pub asset_name: String,
    /// Where to download the package.
    pub asset_url: String,
    /// Where to download `SHA256SUMS.txt`.
    pub sums_url: String,
    /// The package's size by the feed's word (0: unknown). Only the progress uses it.
    pub size: u64,
}

/// Why a request is refused (`code` is the launcher's error code, `message` is for the log).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    /// The `error` of the JSON answer.
    pub code: &'static str,
    /// What is wrong, in English.
    pub message: String,
}

fn refuse(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal {
        code,
        message: message.into(),
    }
}

/// `0.2.0` or `v0.2.0` (with an optional pre-release) as `0.2.0`; `None` for anything else.
pub fn normalize_tag(tag: &str) -> Option<String> {
    let t = tag.strip_prefix(['v', 'V']).unwrap_or(tag);
    let (core, pre) = match t.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (t, None),
    };
    let numbers: Vec<&str> = core.split('.').collect();
    let number = |n: &&str| !n.is_empty() && n.len() <= 9 && n.bytes().all(|b| b.is_ascii_digit());
    if numbers.len() != 3 || !numbers.iter().all(number) {
        return None;
    }
    if let Some(p) = pre {
        let ok = !p.is_empty()
            && p.len() <= 40
            && p.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'));
        if !ok {
            return None;
        }
    }
    Some(t.to_string())
}

/// Checks `url` against the feed and returns its file name: exactly
/// `<prefix><tag or vtag>/<file>`, no query, fragment, escape or dot segment.
fn file_of(feed: &Feed, url: &str, tag: &str, what: &str) -> Result<String, Refusal> {
    let prefix = feed.download_prefix();
    let bad = |why: &str| {
        refuse(
            "bad-url",
            format!("{what}: {why} (only {prefix}<version>/<file> is downloaded)"),
        )
    };
    // The host, owner and repository are not case sensitive; the rest is.
    if url.len() <= prefix.len() || !url.is_char_boundary(prefix.len()) {
        return Err(bad("not a download of this repository's releases"));
    }
    let (head, rest) = url.split_at(prefix.len());
    if !head.eq_ignore_ascii_case(&prefix) {
        return Err(bad("not a download of this repository's releases"));
    }
    let Some((segment, file)) = rest.split_once('/') else {
        return Err(bad("no file name"));
    };
    if segment != tag && segment.strip_prefix('v') != Some(tag) {
        return Err(bad("another version than the one asked for"));
    }
    if !plain(file) || file.starts_with('.') || file.contains("..") {
        return Err(bad("the file name is not a plain one"));
    }
    Ok(file.to_string())
}

/// Checks a request for `kind` (what this copy of the application is updated with).
pub fn check(
    feed: &Feed,
    kind: Kind,
    tag: &str,
    asset_url: &str,
    sums_url: &str,
    size: u64,
) -> Result<Request, Refusal> {
    let Some(tag) = normalize_tag(tag) else {
        return Err(refuse(
            "bad-tag",
            "the version is not major.minor.patch (with an optional pre-release)",
        ));
    };
    let asset_name = file_of(feed, asset_url, &tag, "assetUrl")?;
    let wanted = kind.package_name(&tag);
    if asset_name != wanted {
        return Err(refuse(
            "bad-asset",
            format!("this copy of the application is updated with {wanted}, not {asset_name}"),
        ));
    }
    let sums_name = file_of(feed, sums_url, &tag, "sumsUrl")?;
    if sums_name != SUMS_NAME {
        return Err(refuse(
            "bad-asset",
            format!("sumsUrl is {sums_name}, not {SUMS_NAME}"),
        ));
    }
    Ok(Request {
        tag,
        asset_name,
        asset_url: asset_url.to_string(),
        sums_url: sums_url.to_string(),
        size,
    })
}

/// The SHA-256 (lower case hex) `SHA256SUMS.txt` gives for `name`: lines of `<64 hex> <name>`,
/// the way `sha256sum` writes them (`  ` or ` *` between the two). A name listed twice with two
/// different sums is not trusted.
pub fn sum_for(text: &str, name: &str) -> Option<String> {
    let mut found: Option<String> = None;
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        let Some((sum, rest)) = line.split_once(' ') else {
            continue;
        };
        if !crate::sha256::is_sha256_hex(sum) {
            continue;
        }
        let file = rest.trim_start_matches([' ', '*']);
        if file != name {
            continue;
        }
        let sum = sum.to_ascii_lowercase();
        match &found {
            Some(other) if *other != sum => return None,
            _ => found = Some(sum),
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed() -> Feed {
        Feed {
            origin: "https://github.com".into(),
            owner: "Grohle-developer".into(),
            repo: "Repackshot".into(),
        }
    }

    const BASE: &str = "https://github.com/Grohle-developer/Repackshot/releases/download";

    #[test]
    fn the_feed_is_the_one_the_interface_checks() {
        // The interface's constant, read when this crate is built.
        let f = Feed::embedded();
        assert_eq!(f, feed());
        assert_eq!(
            f.download_prefix(),
            "https://github.com/Grohle-developer/Repackshot/releases/download/"
        );
        // Another repository is another feed; a file without the constant is nothing.
        let other = "export const UPDATE_FEED: UpdateFeed = { owner: 'a', repo: 'b' };";
        assert_eq!(
            Feed::from_source(other, "https://github.com").map(|f| (f.owner, f.repo)),
            Some(("a".into(), "b".into()))
        );
        assert_eq!(Feed::from_source("owner: string;", "https://x"), None);
        let hostile = "const UPDATE_FEED: F = { owner: 'a/../b', repo: 'c' };";
        assert_eq!(Feed::from_source(hostile, "https://x"), None);
    }

    #[test]
    fn package_names_are_the_ones_the_release_script_builds() {
        assert_eq!(
            Kind::Setup.package_name("0.2.0"),
            "Repackshot-0.2.0-windows-x64-setup.exe"
        );
        assert_eq!(
            Kind::WindowsPortable.package_name("0.2.0"),
            "Repackshot-0.2.0-windows-x64-portable.zip"
        );
        assert_eq!(
            Kind::LinuxPortable.package_name("0.2.0"),
            "Repackshot-0.2.0-linux-x64-portable.tar.gz"
        );
        // packaging/release.mjs and src/core/updates.ts spell them the same way.
        let release = include_str!("../../../../../packaging/release.mjs");
        let updates = include_str!("../../../../../src/core/updates.ts");
        for tail in [
            "windows-x64-setup.exe",
            "windows-x64-portable.zip",
            "linux-x64-portable.tar.gz",
        ] {
            assert!(release.contains(tail), "{tail}");
            assert!(updates.contains(tail), "{tail}");
        }
    }

    #[test]
    fn tags_are_versions() {
        assert_eq!(normalize_tag("v0.2.0").as_deref(), Some("0.2.0"));
        assert_eq!(normalize_tag("0.2.0").as_deref(), Some("0.2.0"));
        assert_eq!(
            normalize_tag("1.0.0-beta.2").as_deref(),
            Some("1.0.0-beta.2")
        );
        for bad in [
            "",
            "v",
            "1.2",
            "1.2.3.4",
            "a.b.c",
            "../1.0.0",
            "1.0.0/x",
            "1.0.0-",
            "1.0.0-a b",
            "1.0.0-é",
            "-1.0.0",
            "1..0",
        ] {
            assert_eq!(normalize_tag(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn only_the_feeds_downloads_of_the_asked_version_pass() {
        let asset = format!("{BASE}/v0.2.0/Repackshot-0.2.0-windows-x64-setup.exe");
        let sums = format!("{BASE}/v0.2.0/SHA256SUMS.txt");
        let ok = check(&feed(), Kind::Setup, "0.2.0", &asset, &sums, 7).unwrap();
        assert_eq!(ok.tag, "0.2.0");
        assert_eq!(ok.asset_name, "Repackshot-0.2.0-windows-x64-setup.exe");
        assert_eq!(ok.size, 7);
        // The tag may come with its v, and the URL without one in its path.
        assert!(check(&feed(), Kind::Setup, "v0.2.0", &asset, &sums, 0).is_ok());
        let bare = format!("{BASE}/0.2.0/Repackshot-0.2.0-windows-x64-setup.exe");
        assert!(check(&feed(), Kind::Setup, "0.2.0", &bare, &sums, 0).is_ok());
        // Host, owner and repository do not care about case.
        let upper = asset.replace("github.com/Grohle-developer", "GitHub.com/grohle-DEVELOPER");
        assert!(check(&feed(), Kind::Setup, "0.2.0", &upper, &sums, 0).is_ok());

        let refused = |asset: &str, sums: &str, code: &str| {
            let e = check(&feed(), Kind::Setup, "0.2.0", asset, sums, 0).unwrap_err();
            assert_eq!(e.code, code, "{asset} / {sums}: {}", e.message);
        };
        // Outside the whitelist: another host, another repository, plain http, a lookalike host,
        // a query, a fragment, an escape, a dot segment, a deeper path.
        let name = "Repackshot-0.2.0-windows-x64-setup.exe";
        for url in [
            format!("http://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/{name}"),
            format!("https://evil.example/Grohle-developer/Repackshot/releases/download/v0.2.0/{name}"),
            format!("https://github.com.evil.example/Grohle-developer/Repackshot/releases/download/v0.2.0/{name}"),
            format!("https://github.com/Grohle-developer/Other/releases/download/v0.2.0/{name}"),
            format!("https://github.com/Other/Repackshot/releases/download/v0.2.0/{name}"),
            // The same length as the feed's own, character for character but one.
            format!("https://gitlab.com/Grohle-developer/Repackshot/releases/download/v0.2.0/{name}"),
            format!("https://github.com/Grohle-developeq/Repackshot/releases/download/v0.2.0/{name}"),
            format!("https://github.com/Grohle-developer/Repackshop/releases/download/v0.2.0/{name}"),
            format!("https://github.com/Grohle-developer/Repackshot/releases/upload/v0.2.0/{name}"),
            format!("https://github.com/Grohle-developer/Repackshot/releases/latest/download/{name}"),
            format!("https://github.com/Grohle-developer/Repackshot/archive/v0.2.0/{name}"),
            format!("{BASE}/v0.2.0/{name}?x=1"),
            format!("{BASE}/v0.2.0/{name}#x"),
            format!("{BASE}/v0.2.0/{}", name.replace('-', "%2D")),
            format!("{BASE}/v0.2.0/../v0.2.0/{name}"),
            format!("{BASE}/v0.2.0/sub/{name}"),
            format!("{BASE}/v0.2.0/"),
            format!("{BASE}/v0.2.0"),
            format!("{BASE}/v0.3.0/{name}"),
            format!("{BASE}//{name}"),
            format!(" {BASE}/v0.2.0/{name}"),
            String::new(),
            "https://github.com/".to_string(),
        ] {
            refused(&url, &sums, "bad-url");
        }
        refused(&asset, &asset, "bad-asset");
        refused(&asset, &format!("{BASE}/v0.2.0/other.txt"), "bad-asset");
        refused(&asset, &format!("{BASE}/v0.1.0/SHA256SUMS.txt"), "bad-url");
        // The package for another kind of copy is not for this one.
        let zip = format!("{BASE}/v0.2.0/Repackshot-0.2.0-windows-x64-portable.zip");
        refused(&zip, &sums, "bad-asset");
        let other = format!("{BASE}/v0.2.0/Repackshot-0.1.0-windows-x64-setup.exe");
        refused(&other, &sums, "bad-asset");
        // And a version that is not one.
        let e = check(&feed(), Kind::Setup, "../x", &asset, &sums, 0).unwrap_err();
        assert_eq!(e.code, "bad-tag");
    }

    #[test]
    fn reads_the_sum_of_a_file() {
        let a = "a".repeat(64);
        let b = "B".repeat(64);
        let text = format!(
            "{a}  Repackshot-0.2.0-windows-x64-setup.exe\r\n{b} *Repackshot-0.2.0-windows-x64-portable.zip\nnot a line\n{a}\n"
        );
        assert_eq!(
            sum_for(&text, "Repackshot-0.2.0-windows-x64-setup.exe").as_deref(),
            Some(a.as_str())
        );
        // Either case, the other mark (` *`, binary mode), always lower case back.
        assert_eq!(
            sum_for(&text, "Repackshot-0.2.0-windows-x64-portable.zip"),
            Some(b.to_ascii_lowercase())
        );
        assert_eq!(sum_for(&text, "missing.zip"), None);
        // A prefix of a name is not the name.
        assert_eq!(sum_for(&text, "Repackshot-0.2.0-windows-x64"), None);
        // A sum of the wrong length is no sum; two different sums for a name are no answer.
        assert_eq!(sum_for("abc  x.zip", "x.zip"), None);
        let twice = format!("{a}  x.zip\n{}  x.zip\n", "c".repeat(64));
        assert_eq!(sum_for(&twice, "x.zip"), None);
        let same = format!("{a}  x.zip\n{a}  x.zip\n");
        assert_eq!(sum_for(&same, "x.zip"), Some(a));
    }
}

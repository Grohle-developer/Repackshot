//! A zip reader (PKWARE's APPNOTE.TXT, 6.3): the central directory (with its Zip64 form), stored
//! (method 0) and deflate (method 8) entries with their CRC-32 checked, and an extraction that
//! cannot write outside its folder. The runtime archives of `ai-runtimes.json` are zip files made
//! by Info-ZIP (Linux) and 7-Zip (Windows); nothing here runs a system `unzip`.
//!
//! The central directory is the truth (sizes and CRC of entries written with a data descriptor
//! are only there); a local header only says where the data starts. Encrypted entries, other
//! methods and archives split over several disks are refused, as are names that are absolute,
//! climb with `..`, carry a backslash, a drive letter or anything outside `[A-Za-z0-9._+-]` per
//! component, and symbolic links.

use super::inflate::{inflate_into, InflateError};
use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const EOCD: u32 = 0x0605_4b50;
const ZIP64_EOCD: u32 = 0x0606_4b50;
const ZIP64_LOCATOR: u32 = 0x0706_4b50;
const CENTRAL: u32 = 0x0201_4b50;
const LOCAL: u32 = 0x0403_4b50;

/// Why an archive cannot be read or extracted.
#[derive(Debug)]
pub enum ZipError {
    /// No end of central directory record: not a zip file.
    NotZip,
    /// A record runs past the end of the file.
    Truncated,
    /// Something this reader does not do (another method, encryption, several disks).
    Unsupported(String),
    /// An entry name that could escape its folder or is not portable.
    BadName(String),
    /// The data does not match the directory (CRC-32, size, deflate stream).
    Corrupt(String),
    /// More entries or bytes than the limits allow.
    TooLarge,
    /// The disk.
    Io(io::Error),
}

impl fmt::Display for ZipError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ZipError::NotZip => f.write_str("not a zip archive"),
            ZipError::Truncated => f.write_str("the zip archive is cut short"),
            ZipError::Unsupported(m) => write!(f, "unsupported zip archive: {m}"),
            ZipError::BadName(n) => write!(f, "unsafe or unportable entry name {n:?}"),
            ZipError::Corrupt(m) => write!(f, "damaged zip entry: {m}"),
            ZipError::TooLarge => f.write_str("the zip archive is larger than allowed"),
            ZipError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ZipError {}

impl From<io::Error> for ZipError {
    fn from(e: io::Error) -> ZipError {
        if e.kind() == io::ErrorKind::UnexpectedEof {
            ZipError::Truncated
        } else {
            ZipError::Io(e)
        }
    }
}

/// One entry of the central directory.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    /// The name, `/`-separated, as stored.
    pub name: String,
    /// 0 stored, 8 deflate.
    pub method: u16,
    /// General purpose flags (bit 0 encrypted, bit 3 data descriptor, bit 11 UTF-8).
    pub flags: u16,
    /// CRC-32 of the uncompressed data.
    pub crc32: u32,
    /// Bytes in the archive.
    pub compressed: u64,
    /// Bytes once extracted.
    pub size: u64,
    /// Where its local header is.
    pub local_offset: u64,
    /// Unix permission and type bits, when the archive was made on Unix.
    pub unix_mode: Option<u32>,
}

impl Entry {
    /// A folder entry (its name ends with `/`).
    pub fn is_dir(&self) -> bool {
        self.name.ends_with('/')
    }

    /// A symbolic link (Unix archives only).
    pub fn is_symlink(&self) -> bool {
        self.unix_mode.is_some_and(|m| m & 0o170000 == 0o120000)
    }

    /// Should be executable once extracted (Unix archives only).
    pub fn is_executable(&self) -> bool {
        self.unix_mode.is_some_and(|m| m & 0o111 != 0)
    }
}

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn u64_at(b: &[u8], at: usize) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[at..at + 8]);
    u64::from_le_bytes(a)
}

fn read_exact_at<R: Read + Seek>(r: &mut R, at: u64, len: usize) -> Result<Vec<u8>, ZipError> {
    r.seek(SeekFrom::Start(at))?;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

/// An open archive.
pub struct Archive<R> {
    reader: R,
    /// The entries, in directory order.
    pub entries: Vec<Entry>,
}

impl<R: Read + Seek> Archive<R> {
    /// Reads the central directory (at most `max_entries` entries).
    pub fn open(mut reader: R, max_entries: usize) -> Result<Archive<R>, ZipError> {
        let len = reader.seek(SeekFrom::End(0))?;
        // The end record is 22 bytes plus a comment of up to 65535.
        let tail_len = len.min(22 + 65_535);
        let tail = read_exact_at(&mut reader, len - tail_len, tail_len as usize)?;
        let at = (0..tail.len().saturating_sub(21))
            .rev()
            .find(|&i| {
                u32_at(&tail, i) == EOCD
                    && i + 22 + usize::from(u16_at(&tail, i + 20)) <= tail.len()
            })
            .ok_or(ZipError::NotZip)?;
        let eocd = &tail[at..at + 22];
        let eocd_pos = len - tail_len + at as u64;
        let (disk, cd_disk) = (u16_at(eocd, 4), u16_at(eocd, 6));
        let mut count = u64::from(u16_at(eocd, 10));
        let mut cd_size = u64::from(u32_at(eocd, 12));
        let mut cd_offset = u64::from(u32_at(eocd, 16));
        if disk != 0 || cd_disk != 0 || u16_at(eocd, 8) != u16_at(eocd, 10) {
            return Err(ZipError::Unsupported("split over several disks".into()));
        }
        if count == 0xffff || cd_size == 0xffff_ffff || cd_offset == 0xffff_ffff {
            // Zip64: the locator sits just before the end record.
            if eocd_pos < 20 {
                return Err(ZipError::Truncated);
            }
            let loc = read_exact_at(&mut reader, eocd_pos - 20, 20)?;
            if u32_at(&loc, 0) != ZIP64_LOCATOR {
                return Err(ZipError::Corrupt("no Zip64 locator".into()));
            }
            let rec = read_exact_at(&mut reader, u64_at(&loc, 8), 56)?;
            if u32_at(&rec, 0) != ZIP64_EOCD {
                return Err(ZipError::Corrupt("no Zip64 end record".into()));
            }
            count = u64_at(&rec, 32);
            cd_size = u64_at(&rec, 40);
            cd_offset = u64_at(&rec, 48);
        }
        if count > max_entries as u64 {
            return Err(ZipError::TooLarge);
        }
        if cd_offset.checked_add(cd_size).is_none_or(|end| end > len) || cd_size > 64 << 20 {
            return Err(ZipError::Truncated);
        }
        let cd = read_exact_at(&mut reader, cd_offset, cd_size as usize)?;
        let mut entries = Vec::with_capacity(count as usize);
        let mut p = 0usize;
        for _ in 0..count {
            if p + 46 > cd.len() || u32_at(&cd, p) != CENTRAL {
                return Err(ZipError::Corrupt("bad central directory".into()));
            }
            let h = &cd[p..p + 46];
            let made_by_os = u16_at(h, 4) >> 8;
            let (name_len, extra_len, comment_len) = (
                usize::from(u16_at(h, 28)),
                usize::from(u16_at(h, 30)),
                usize::from(u16_at(h, 32)),
            );
            let end = p + 46 + name_len + extra_len + comment_len;
            if end > cd.len() {
                return Err(ZipError::Truncated);
            }
            let name_bytes = &cd[p + 46..p + 46 + name_len];
            let name = String::from_utf8(name_bytes.to_vec())
                .map_err(|_| ZipError::BadName(String::from_utf8_lossy(name_bytes).into_owned()))?;
            let mut e = Entry {
                name,
                method: u16_at(h, 10),
                flags: u16_at(h, 8),
                crc32: u32_at(h, 16),
                compressed: u64::from(u32_at(h, 20)),
                size: u64::from(u32_at(h, 24)),
                local_offset: u64::from(u32_at(h, 42)),
                unix_mode: (made_by_os == 3).then(|| u32_at(h, 38) >> 16),
            };
            // A Zip64 extra field carries, in this order, the values marked 0xffffffff.
            let mut x = &cd[p + 46 + name_len..p + 46 + name_len + extra_len];
            while x.len() >= 4 {
                let (id, size) = (u16_at(x, 0), usize::from(u16_at(x, 2)));
                if x.len() < 4 + size {
                    break;
                }
                if id == 1 {
                    let mut f = &x[4..4 + size];
                    for v in [&mut e.size, &mut e.compressed, &mut e.local_offset] {
                        if *v == 0xffff_ffff {
                            if f.len() < 8 {
                                return Err(ZipError::Corrupt("short Zip64 field".into()));
                            }
                            *v = u64_at(f, 0);
                            f = &f[8..];
                        }
                    }
                }
                x = &x[4 + size..];
            }
            entries.push(e);
            p = end;
        }
        Ok(Archive { reader, entries })
    }

    /// The bytes of entry `index`, inflated and checked against its size and CRC-32. Entries
    /// larger than `limit` are refused.
    pub fn read(&mut self, index: usize, limit: u64) -> Result<Vec<u8>, ZipError> {
        let e = self.entries[index].clone();
        if e.flags & 1 != 0 {
            return Err(ZipError::Unsupported(format!("{} is encrypted", e.name)));
        }
        if e.size > limit || e.compressed > limit.saturating_add(1 << 16) {
            return Err(ZipError::TooLarge);
        }
        let local = read_exact_at(&mut self.reader, e.local_offset, 30)?;
        if u32_at(&local, 0) != LOCAL {
            return Err(ZipError::Corrupt(format!("{}: no local header", e.name)));
        }
        let skip = 30 + u64::from(u16_at(&local, 26)) + u64::from(u16_at(&local, 28));
        let data = read_exact_at(
            &mut self.reader,
            e.local_offset + skip,
            e.compressed as usize,
        )?;
        let out = match e.method {
            0 => data,
            8 => {
                let mut out = Vec::with_capacity(e.size as usize);
                inflate_into(&data, &mut out, e.size as usize).map_err(|err| match err {
                    InflateError::TooLarge => {
                        ZipError::Corrupt(format!("{}: larger than its size", e.name))
                    }
                    other => ZipError::Corrupt(format!("{}: {other}", e.name)),
                })?;
                out
            }
            m => {
                return Err(ZipError::Unsupported(format!(
                    "{}: compression method {m}",
                    e.name
                )))
            }
        };
        if out.len() as u64 != e.size {
            return Err(ZipError::Corrupt(format!(
                "{}: {} bytes instead of {}",
                e.name,
                out.len(),
                e.size
            )));
        }
        if rt_core::png::crc32(&out) != e.crc32 {
            return Err(ZipError::Corrupt(format!(
                "{}: CRC-32 does not match",
                e.name
            )));
        }
        Ok(out)
    }
}

/// How much an extraction may write.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// Entries in the archive.
    pub entries: usize,
    /// Bytes of one entry.
    pub entry_bytes: u64,
    /// Bytes in all.
    pub total_bytes: u64,
}

impl Default for Limits {
    /// Generous for a runtime build (the largest is about 90 MB unpacked), tight for a zip bomb.
    fn default() -> Limits {
        Limits {
            entries: 4096,
            entry_bytes: 1 << 30,
            total_bytes: 4 << 30,
        }
    }
}

/// The components of a safe relative name, or why not. A trailing `/` (a folder) is allowed.
pub fn safe_components(name: &str) -> Result<Vec<&str>, ZipError> {
    let bad = || ZipError::BadName(name.to_string());
    let trimmed = name.strip_suffix('/').unwrap_or(name);
    if trimmed.is_empty() || trimmed.len() > 512 {
        return Err(bad());
    }
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() > 8 {
        return Err(bad());
    }
    for p in &parts {
        let ok = !p.is_empty()
            && p.len() <= 128
            && !p.starts_with('.')
            && p.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'+'));
        if !ok {
            return Err(bad());
        }
    }
    Ok(parts)
}

/// One extracted file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Extracted {
    /// The name in the archive.
    pub name: String,
    /// Where it went.
    pub path: PathBuf,
    /// Its size.
    pub size: u64,
}

/// Extracts every entry of the archive at `archive` into `dest` (created; it must not contain
/// anything yet). Folders are created, files written whole, executables marked so on Unix; a
/// name that is not safe, a symbolic link or a damaged entry stops it with nothing left behind
/// but `dest` itself, which the caller removes.
pub fn extract(archive: &Path, dest: &Path, limits: Limits) -> Result<Vec<Extracted>, ZipError> {
    let mut a = Archive::open(File::open(archive)?, limits.entries)?;
    // Check every name before writing anything.
    let mut total = 0u64;
    for e in &a.entries {
        safe_components(&e.name)?;
        if e.is_symlink() {
            return Err(ZipError::Unsupported(format!(
                "{} is a symbolic link",
                e.name
            )));
        }
        if e.size > limits.entry_bytes {
            return Err(ZipError::TooLarge);
        }
        total = total.saturating_add(e.size);
    }
    if total > limits.total_bytes {
        return Err(ZipError::TooLarge);
    }
    fs::create_dir_all(dest)?;
    let mut out = Vec::new();
    for i in 0..a.entries.len() {
        let e = a.entries[i].clone();
        let mut path = dest.to_path_buf();
        for c in safe_components(&e.name)? {
            path.push(c);
        }
        if e.is_dir() {
            fs::create_dir_all(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let data = a.read(i, limits.entry_bytes)?;
        // `create_new`: two entries with the same name (or a file over a folder) are refused.
        let mut f = File::options().write(true).create_new(true).open(&path)?;
        f.write_all(&data)?;
        f.sync_all()?;
        drop(f);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = if e.is_executable() { 0o755 } else { 0o644 };
            fs::set_permissions(&path, fs::Permissions::from_mode(mode))?;
        }
        out.push(Extracted {
            name: e.name,
            path,
            size: data.len() as u64,
        });
    }
    Ok(out)
}

/// Writes a zip of stored entries (tests, and the fake runtime of the integration tests): local
/// headers, the central directory and, with `zip64`, the Zip64 end records and extra fields.
pub fn write_stored(entries: &[(&str, &[u8], u32)], zip64: bool) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for &(name, data, mode) in entries {
        let offset = out.len() as u32;
        let crc = rt_core::png::crc32(data);
        let size = data.len() as u32;
        out.extend_from_slice(&LOCAL.to_le_bytes());
        out.extend_from_slice(&[20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);
        let extra: Vec<u8> = if zip64 {
            let mut x = vec![1, 0, 24, 0];
            x.extend_from_slice(&u64::from(size).to_le_bytes());
            x.extend_from_slice(&u64::from(size).to_le_bytes());
            x.extend_from_slice(&u64::from(offset).to_le_bytes());
            x
        } else {
            Vec::new()
        };
        let (s, o) = if zip64 {
            (0xffff_ffffu32, 0xffff_ffffu32)
        } else {
            (size, offset)
        };
        central.extend_from_slice(&CENTRAL.to_le_bytes());
        central.extend_from_slice(&[20, 3, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&s.to_le_bytes());
        central.extend_from_slice(&s.to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&(extra.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        central.extend_from_slice(&(mode << 16).to_le_bytes());
        central.extend_from_slice(&o.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
        central.extend_from_slice(&extra);
    }
    let cd_offset = out.len() as u64;
    out.extend_from_slice(&central);
    let n = entries.len() as u64;
    if zip64 {
        let rec = out.len() as u64;
        out.extend_from_slice(&ZIP64_EOCD.to_le_bytes());
        out.extend_from_slice(&44u64.to_le_bytes());
        out.extend_from_slice(&[45, 3, 45, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        out.extend_from_slice(&n.to_le_bytes());
        out.extend_from_slice(&n.to_le_bytes());
        out.extend_from_slice(&(central.len() as u64).to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&ZIP64_LOCATOR.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&rec.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
    }
    out.extend_from_slice(&EOCD.to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    let (count, size, offset) = if zip64 {
        (0xffffu16, 0xffff_ffffu32, 0xffff_ffffu32)
    } else {
        (n as u16, central.len() as u32, cd_offset as u32)
    };
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sha256::{hex, Sha256};
    use std::io::Cursor;

    /// Made with Info-ZIP's `zip -X -9` (then `-0` for `noise.bin`), as the Linux builds are.
    const INFO_ZIP: &[u8] = include_bytes!("../../tests/fixtures/runtime-sample.zip");
    /// Made with Python's `zipfile` into a stream that cannot seek: data descriptors, DOS made.
    const STREAMED: &[u8] = include_bytes!("../../tests/fixtures/descriptor-sample.zip");

    fn sha(d: &[u8]) -> String {
        hex(&Sha256::digest(d))
    }

    #[test]
    fn an_info_zip_archive_with_deflate_stored_folders_and_modes() {
        let mut a = Archive::open(Cursor::new(INFO_ZIP), 100).unwrap();
        let names: Vec<&str> = a.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "sd-server",
                "ggml.txt",
                "empty.txt",
                "lib/",
                "lib/libz.so.1",
                "noise.bin"
            ]
        );
        let methods: Vec<u16> = a.entries.iter().map(|e| e.method).collect();
        assert_eq!(methods, [0, 8, 0, 0, 8, 0]);
        assert!(a.entries[0].is_executable() && a.entries[4].is_executable());
        assert!(!a.entries[1].is_executable() && a.entries[3].is_dir());
        let ggml = a.read(1, 1 << 20).unwrap();
        assert_eq!(
            sha(&ggml),
            "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d"
        );
        assert!(String::from_utf8(ggml).unwrap().starts_with("MIT License"));
        assert_eq!(
            sha(&a.read(4, 1 << 20).unwrap()),
            "bd3a3b9c21724c34874d83b816feedd6a31f13622c765569b301e709c0d32cb5"
        );
        assert_eq!(
            sha(&a.read(5, 1 << 20).unwrap()),
            "0ee0b811d80affcc3ebbcbbcf05ab2043e67c5787fe7e5a56accb282588aff8a"
        );
        assert_eq!(a.read(2, 10).unwrap(), b"");
        assert!(matches!(a.read(1, 100), Err(ZipError::TooLarge)));

        let dir = crate::test_dir("zip-extract");
        let dest = dir.join("out");
        let files = extract_bytes(INFO_ZIP, &dir, &dest).unwrap();
        assert_eq!(files.len(), 5);
        assert_eq!(
            fs::read(dest.join("sd-server")).unwrap(),
            b"#!/bin/sh\necho fake sd-server\n"
        );
        assert_eq!(
            fs::read(dest.join("lib/libz.so.1")).unwrap(),
            vec![b'z'; 3000]
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &str| fs::metadata(dest.join(p)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode("sd-server"), 0o755);
            assert_eq!(mode("lib/libz.so.1"), 0o755);
            assert_eq!(mode("ggml.txt"), 0o644);
        }
    }

    fn extract_bytes(zip: &[u8], dir: &Path, dest: &Path) -> Result<Vec<Extracted>, ZipError> {
        let file = dir.join(format!("a-{}.zip", sha(zip)));
        fs::write(&file, zip).unwrap();
        extract(&file, dest, Limits::default())
    }

    /// `RPX_SDCPP_ZIP=<a release archive of ai-runtimes.json> cargo test -p rt-app --lib
    /// real_release -- --ignored --nocapture`: unpacks it (every entry's CRC-32 checked) and
    /// prints the SHA-256 of every file, to compare with another unzip.
    #[test]
    #[ignore = "needs RPX_SDCPP_ZIP, a real stable-diffusion.cpp release archive"]
    fn a_real_release_archive() {
        let Some(zip) = std::env::var_os("RPX_SDCPP_ZIP") else {
            return;
        };
        let dest = crate::test_dir("zip-real").join("out");
        let files = extract(Path::new(&zip), &dest, Limits::default()).unwrap();
        assert!(files.iter().any(|f| f.name.starts_with("sd-server")));
        for f in &files {
            println!("{}  {}", sha(&fs::read(&f.path).unwrap()), f.name);
        }
    }

    #[test]
    fn a_streamed_archive_with_data_descriptors() {
        let mut a = Archive::open(Cursor::new(STREAMED), 10).unwrap();
        assert!(a
            .entries
            .iter()
            .all(|e| e.flags & 8 != 0 && e.unix_mode.is_none()));
        let exe = a.read(0, 1 << 20).unwrap();
        assert!(exe.starts_with(b"MZfake windows program"));
        assert_eq!(exe.len(), 842);
        let text = String::from_utf8(a.read(1, 1 << 20).unwrap()).unwrap();
        assert!(text.contains("Copyright (c) 2023-2026 The leejet"));
    }

    #[test]
    fn stored_entries_and_zip64_records() {
        for zip64 in [false, true] {
            let z = write_stored(
                &[("a.txt", b"alpha", 0o100644), ("bin/run", b"#!", 0o100755)],
                zip64,
            );
            let mut a = Archive::open(Cursor::new(z), 10).unwrap();
            assert_eq!(a.entries.len(), 2, "zip64 {zip64}");
            assert_eq!(a.entries[1].local_offset, 40);
            assert_eq!(a.read(0, 100).unwrap(), b"alpha");
            assert_eq!(a.read(1, 100).unwrap(), b"#!");
            assert!(a.entries[1].is_executable());
        }
        // Too many entries for the limit.
        let z = write_stored(&[("a", b"1", 0), ("b", b"2", 0)], false);
        assert!(matches!(
            Archive::open(Cursor::new(z), 1),
            Err(ZipError::TooLarge)
        ));
    }

    #[test]
    fn damaged_and_hostile_archives_are_refused() {
        assert!(matches!(
            Archive::open(Cursor::new(b"not a zip at all".to_vec()), 10),
            Err(ZipError::NotZip)
        ));
        // A flipped byte in deflate data: the CRC (or the stream) says so.
        let mut bad = INFO_ZIP.to_vec();
        let mut a = Archive::open(Cursor::new(INFO_ZIP), 10).unwrap();
        let e = a.entries[1].clone();
        let local = 30 + e.name.len() + e.local_offset as usize;
        bad[local + 40] ^= 0x20;
        let mut b = Archive::open(Cursor::new(bad), 10).unwrap();
        assert!(matches!(b.read(1, 1 << 20), Err(ZipError::Corrupt(_))));
        // A stored entry whose CRC is wrong.
        let mut z = write_stored(&[("a.txt", b"alpha", 0)], false);
        z[30 + 5] ^= 1; // the first byte of the data
        let mut c = Archive::open(Cursor::new(z), 10).unwrap();
        assert!(matches!(c.read(0, 100), Err(ZipError::Corrupt(_))));
        assert_eq!(a.read(1, 1 << 20).map(|d| d.len()).ok(), Some(1078));

        let dir = crate::test_dir("zip-hostile");
        for name in [
            "../evil",
            "/etc/passwd",
            "a/../../b",
            "C:/x",
            "a\\b",
            ".hidden",
            "a//b",
            "a b",
            "é",
        ] {
            let z = write_stored(&[("ok.txt", b"1", 0), (name, b"2", 0)], false);
            let dest = dir.join(format!("d{}", sha(name.as_bytes())));
            assert!(
                matches!(extract_bytes(&z, &dir, &dest), Err(ZipError::BadName(_))),
                "{name}"
            );
            assert!(!dest.join("ok.txt").exists(), "nothing written for {name}");
        }
        assert!(!dir.join("evil").exists());
        // A symbolic link, and the same name twice.
        let z = write_stored(&[("link", b"/etc/passwd", 0o120777)], false);
        assert!(matches!(
            extract_bytes(&z, &dir, &dir.join("s")),
            Err(ZipError::Unsupported(_))
        ));
        let z = write_stored(&[("x", b"1", 0), ("x", b"2", 0)], false);
        assert!(matches!(
            extract_bytes(&z, &dir, &dir.join("t")),
            Err(ZipError::Io(_))
        ));
        assert_eq!(
            safe_components("lib/libggml.so.0").unwrap(),
            ["lib", "libggml.so.0"]
        );
        assert!(safe_components("folder/").is_ok());
    }
}

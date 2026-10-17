//! What the launcher keeps of the final renders that asked for passes (phase X2, AI-POST.md §7.3
//! and §7.4): the linear image (the job's last frame, its RGBA sums) and its exact passes, by job
//! id, so that the AI post-processing (X3c, `POST /api/ai/post` with `{renderId, …}`) works from
//! them in the launcher without the pixels travelling to the page and back. The page may also
//! read the passes (`GET /api/render/<id>/passes`, [`write_passes`]).
//!
//! **Bounded.** At most [`KeepLimits::renders`] renders ([`KEEP_RENDERS`]) are kept; a new one
//! evicts the oldest. A render whose image and passes together take more than
//! [`KeepLimits::in_memory`] bytes ([`KEEP_IN_MEMORY`], 64 MiB: about 1.5 megapixels with every
//! pass) goes to `<data>/cache/ai/<id>.rpx` (the image as an `RPX1` frame) and `<id>.rpp` (the
//! passes as an `RPP1` file) instead of staying in memory, so memory holds at most a few of those
//! limits. Job ids start again at every launch: the folder's `.rpx`, `.rpp` and `.tmp` files of
//! a previous launch are removed when the store is made (one launcher per data folder,
//! `instance.rs`). Cancelling or forgetting the job (`DELETE /api/render/<id>`) keeps what was
//! kept; only eviction removes it.
//!
//! **`RPP1`** (little-endian; 32 bytes of header, then the planes):
//!
//! | Byte | Field |
//! | --- | --- |
//! | 0 | `"RPP1"` |
//! | 4 | `u32` header length (32; the planes start there) |
//! | 8, 12 | `u32` width, height |
//! | 16 | `u32` the passes present: bit `i` is `PASS_KEYS[i]` of `src/core/passes.ts` |
//! | 20 | `u32` samples the albedo is the mean of |
//! | 24 | `u32` the render job's id |
//! | 28 | `u32` 0 (reserved) |
//! | 32 | for every bit set, in order: `width × height × channels` words, rows from the top (`f32`; `u32` for `partId` and `materialId`) |

use crate::render::Frame;
use rt_core::passes::{Passes, Plane, PASS_ALL, PASS_CHANNELS, PASS_MATERIAL_ID, PASS_PART_ID};
use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// The passes file magic.
pub const PASSES_MAGIC: [u8; 4] = *b"RPP1";
/// Bytes of the passes header.
pub const PASSES_HEADER: usize = 32;
/// Renders kept at most.
pub const KEEP_RENDERS: usize = 4;
/// Largest render (image and passes) kept in memory; a larger one goes to the cache folder.
pub const KEEP_IN_MEMORY: u64 = 64 << 20;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// How much the store keeps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeepLimits {
    /// Renders kept at most (at least one).
    pub renders: usize,
    /// Largest render kept in memory, in bytes; larger ones go to the cache folder (when there is
    /// one).
    pub in_memory: u64,
}

impl Default for KeepLimits {
    fn default() -> KeepLimits {
        KeepLimits {
            renders: KEEP_RENDERS,
            in_memory: KEEP_IN_MEMORY,
        }
    }
}

/// How a render is looked at: the exposure and tone curve of its scene (`RNDR`), which the AI
/// post-processing needs to see the image as the person does (X3c).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Look {
    /// `RNDR.tonemap` (`rt_core::color::Tonemap` codes).
    pub tonemap: u32,
    /// `RNDR.exposure_ev`.
    pub exposure_ev: f32,
}

impl Default for Look {
    /// ACES at 0 EV, the RSB's defaults.
    fn default() -> Look {
        Look {
            tonemap: 1,
            exposure_ev: 0.0,
        }
    }
}

/// A kept render: the image and its passes.
#[derive(Clone, Debug)]
pub struct KeptRender {
    /// The job's id.
    pub id: u32,
    /// Its last frame: the RGBA sums of `samples` samples.
    pub image: Frame,
    /// Its exact passes.
    pub passes: Arc<Passes>,
    /// Its exposure and tone curve.
    pub look: Look,
}

impl KeptRender {
    /// Bytes of image and passes.
    pub fn bytes(&self) -> u64 {
        self.image.len(true) + self.passes.byte_len() as u64
    }
}

/// Where a kept render is.
enum Place {
    Memory(KeptRender),
    /// In the cache folder: the image (`RPX1`) and the passes (`RPP1`); the look stays here.
    Disk {
        image: PathBuf,
        passes: PathBuf,
        look: Look,
    },
}

/// The kept renders, oldest first.
pub struct Kept {
    limits: KeepLimits,
    dir: Option<PathBuf>,
    entries: Mutex<VecDeque<(u32, Place)>>,
}

/// The header of a passes file.
pub fn passes_header(id: u32, samples: u32, passes: &Passes) -> [u8; PASSES_HEADER] {
    let mut h = [0u8; PASSES_HEADER];
    h[..4].copy_from_slice(&PASSES_MAGIC);
    for (i, v) in [
        PASSES_HEADER as u32,
        passes.width,
        passes.height,
        passes.mask,
        samples,
        id,
        0,
    ]
    .into_iter()
    .enumerate()
    {
        h[4 + i * 4..8 + i * 4].copy_from_slice(&v.to_le_bytes());
    }
    h
}

/// Writes the passes file of render `id` (header and planes).
pub fn write_passes(id: u32, samples: u32, passes: &Passes, w: &mut dyn Write) -> io::Result<()> {
    w.write_all(&passes_header(id, samples, passes))?;
    // In slices, so a big plane does not take a second copy of itself.
    let mut buf = Vec::with_capacity(64 * 1024);
    let mut words = |w: &mut dyn Write, bits: &mut dyn Iterator<Item = u32>| -> io::Result<()> {
        loop {
            buf.clear();
            for v in (&mut *bits).take(16 * 1024) {
                buf.extend_from_slice(&v.to_le_bytes());
            }
            if buf.is_empty() {
                return Ok(());
            }
            w.write_all(&buf)?;
        }
    };
    for plane in passes.planes() {
        match plane {
            Plane::F32(v) => words(w, &mut v.iter().map(|x| x.to_bits()))?,
            Plane::U32(v) => words(w, &mut v.iter().copied())?,
        }
    }
    Ok(())
}

/// Bytes [`write_passes`] writes.
pub fn passes_len(passes: &Passes) -> u64 {
    PASSES_HEADER as u64 + passes.byte_len() as u64
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

/// Reads a passes file: `(id, samples, passes)`, or `None` when it is not one.
pub fn read_passes(bytes: &[u8]) -> Option<(u32, u32, Passes)> {
    if bytes.get(..4)? != PASSES_MAGIC {
        return None;
    }
    let header = u32_at(bytes, 4)? as usize;
    let (width, height, mask) = (u32_at(bytes, 8)?, u32_at(bytes, 12)?, u32_at(bytes, 16)?);
    let (samples, id) = (u32_at(bytes, 20)?, u32_at(bytes, 24)?);
    if header < PASSES_HEADER {
        return None;
    }
    let mut passes = Passes::new(width, height, mask & PASS_ALL);
    let n = width as usize * height as usize;
    let mut pos = header;
    for (i, &channels) in PASS_CHANNELS.iter().enumerate() {
        let bit = 1u32 << i;
        if passes.mask & bit == 0 {
            continue;
        }
        let len = n.checked_mul(channels)?.checked_mul(4)?;
        let data = bytes.get(pos..pos.checked_add(len)?)?;
        pos += len;
        let words = data
            .chunks_exact(4)
            .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]));
        if bit == PASS_PART_ID || bit == PASS_MATERIAL_ID {
            let ids: Vec<u32> = words.collect();
            if bit == PASS_PART_ID {
                passes.part_id = ids;
            } else {
                passes.material_id = ids;
            }
        } else {
            let floats: Vec<f32> = words.map(f32::from_bits).collect();
            match i {
                0 => passes.albedo = floats,
                1 => passes.normal = floats,
                2 => passes.depth = floats,
                _ => passes.coc = floats,
            }
        }
    }
    Some((id, samples, passes))
}

/// Writes `bytes` (produced by `write`) to `path` through a temporary file next to it.
fn write_file(path: &Path, write: impl FnOnce(&mut dyn Write) -> io::Result<()>) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    let result = (|| {
        let mut file = io::BufWriter::new(File::create(&tmp)?);
        write(&mut file)?;
        file.into_inner().map_err(|e| e.into_error())?.sync_all()
    })();
    match result.and_then(|()| fs::rename(&tmp, path)) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// True for the files this store writes: `<digits>.rpx`, `<digits>.rpp`, `<digits>.tmp`.
fn ours(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    matches!(ext, "rpx" | "rpp" | "tmp")
        && !stem.is_empty()
        && stem.bytes().all(|b| b.is_ascii_digit())
}

/// Body of `GET /api/render/<id>/passes`: its length and a writer for it.
pub struct PassesBody {
    /// Bytes the writer writes.
    pub len: u64,
    /// Writes them.
    pub write: crate::http::Writer,
}

impl Kept {
    /// A store with `limits`, spilling large renders into `dir` (`None`: everything in memory).
    /// The files a previous launch left in `dir` are removed.
    pub fn new(limits: KeepLimits, dir: Option<PathBuf>) -> Kept {
        if let Some(dir) = &dir {
            if let Ok(entries) = fs::read_dir(dir) {
                for e in entries.filter_map(Result::ok) {
                    let name = e.file_name().into_string().unwrap_or_default();
                    let file = fs::symlink_metadata(e.path()).is_ok_and(|m| m.is_file());
                    if ours(&name) && file {
                        let _ = fs::remove_file(e.path());
                    }
                }
            }
        }
        Kept {
            limits: KeepLimits {
                renders: limits.renders.max(1),
                in_memory: limits.in_memory,
            },
            dir,
            entries: Mutex::new(VecDeque::new()),
        }
    }

    /// Keeps `render`, evicting the oldest beyond the limit. A large one is written to the cache
    /// folder (kept in memory if that fails, rather than lost).
    pub fn keep(&self, render: KeptRender) {
        let id = render.id;
        let place = match &self.dir {
            Some(dir) if render.bytes() > self.limits.in_memory => {
                match Kept::spill(dir, &render) {
                    Ok((image, passes)) => Place::Disk {
                        image,
                        passes,
                        look: render.look,
                    },
                    Err(e) => {
                        crate::log::line(&format!("render {id}: cannot keep it on disk: {e}"));
                        Place::Memory(render)
                    }
                }
            }
            _ => Place::Memory(render),
        };
        let evicted: Vec<Place> = {
            let mut entries = lock(&self.entries);
            entries.retain(|(i, _)| *i != id);
            entries.push_back((id, place));
            let extra = entries.len().saturating_sub(self.limits.renders);
            entries.drain(..extra).map(|(_, p)| p).collect()
        };
        for place in evicted {
            if let Place::Disk { image, passes, .. } = place {
                let _ = fs::remove_file(image);
                let _ = fs::remove_file(passes);
            }
        }
    }

    fn spill(dir: &Path, render: &KeptRender) -> io::Result<(PathBuf, PathBuf)> {
        fs::create_dir_all(dir)?;
        let image = dir.join(format!("{}.rpx", render.id));
        let passes = dir.join(format!("{}.rpp", render.id));
        write_file(&image, |w| render.image.write(true, w))?;
        if let Err(e) = write_file(&passes, |w| {
            write_passes(render.id, render.image.samples, &render.passes, w)
        }) {
            let _ = fs::remove_file(&image);
            return Err(e);
        }
        Ok((image, passes))
    }

    /// The ids kept, oldest first.
    pub fn ids(&self) -> Vec<u32> {
        lock(&self.entries).iter().map(|(id, _)| *id).collect()
    }

    /// True when render `id` is kept on disk (not in memory).
    pub fn on_disk(&self, id: u32) -> bool {
        lock(&self.entries)
            .iter()
            .any(|(i, p)| *i == id && matches!(p, Place::Disk { .. }))
    }

    /// Render `id`, read back from the cache folder when it is there.
    pub fn get(&self, id: u32) -> Option<KeptRender> {
        let (image, passes, look) = {
            let entries = lock(&self.entries);
            match &entries.iter().find(|(i, _)| *i == id)?.1 {
                Place::Memory(render) => return Some(render.clone()),
                Place::Disk {
                    image,
                    passes,
                    look,
                } => (image.clone(), passes.clone(), *look),
            }
        };
        let frame = Frame::read(&fs::read(image).ok()?)?;
        let (_, _, passes) = read_passes(&fs::read(passes).ok()?)?;
        Some(KeptRender {
            id,
            image: frame,
            passes: Arc::new(passes),
            look,
        })
    }

    /// The passes file of render `id`, to serve (a file of the cache folder is streamed as it is).
    pub fn passes_body(&self, id: u32) -> Option<PassesBody> {
        let entries = lock(&self.entries);
        match &entries.iter().find(|(i, _)| *i == id)?.1 {
            Place::Memory(render) => {
                let passes = Arc::clone(&render.passes);
                let samples = render.image.samples;
                Some(PassesBody {
                    len: passes_len(&passes),
                    write: Box::new(move |w| write_passes(id, samples, &passes, w)),
                })
            }
            Place::Disk { passes, .. } => {
                // Opened now: an eviction that removes it later does not cut this answer short.
                let mut file = File::open(passes).ok()?;
                let len = file.metadata().ok()?.len();
                Some(PassesBody {
                    len,
                    write: Box::new(move |w| {
                        let copied = io::copy(&mut (&mut file).take(len), w)?;
                        if copied == len {
                            Ok(())
                        } else {
                            Err(io::Error::new(
                                io::ErrorKind::UnexpectedEof,
                                "short passes file",
                            ))
                        }
                    }),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rt_core::passes::{PassFilm, PASS_ALBEDO, PASS_DEPTH};

    /// A kept render of `w × h` whose planes say which render they are.
    fn render(id: u32, w: u32, h: u32, mask: u32) -> KeptRender {
        let mut film = PassFilm::new(w, h, mask);
        film.depth.iter_mut().for_each(|d| *d = id as f32);
        film.part_id.iter_mut().for_each(|p| *p = id);
        let passes = film.resolve();
        KeptRender {
            id,
            image: Frame {
                pass: 3,
                samples: 5,
                width: w,
                height: h,
                seconds: 1.5,
                flags: crate::render::FLAG_DONE,
                max_samples: 5,
                threads: 2,
                rays: 1234,
                sums: Arc::new((0..w * h * 4).map(|i| i as f32 + id as f32).collect()),
                noisy: None,
                version: 3,
                adaptive: None,
            },
            passes: Arc::new(passes),
            look: Look {
                tonemap: id % 5,
                exposure_ev: id as f32 * 0.25,
            },
        }
    }

    fn body(b: PassesBody) -> Vec<u8> {
        let mut out = Vec::new();
        (b.write)(&mut out).unwrap();
        assert_eq!(out.len() as u64, b.len);
        out
    }

    #[test]
    fn the_passes_file_round_trips_and_says_what_it_holds() {
        let r = render(9, 3, 2, PASS_ALL);
        let mut bytes = Vec::new();
        write_passes(9, 5, &r.passes, &mut bytes).unwrap();
        assert_eq!(bytes.len() as u64, passes_len(&r.passes));
        assert_eq!(&bytes[..4], b"RPP1");
        let word = |i: usize| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
        assert_eq!(
            [
                word(4),
                word(8),
                word(12),
                word(16),
                word(20),
                word(24),
                word(28)
            ],
            [32, 3, 2, 63, 5, 9, 0]
        );
        // Planes in key order: albedo (18 words), normal (18), depth (6), then the part ids.
        assert_eq!(word(32 + (18 + 18 + 6) * 4), 9);
        let (id, samples, back) = read_passes(&bytes).unwrap();
        assert_eq!((id, samples), (9, 5));
        assert_eq!(&back, r.passes.as_ref());
        // A subset, a short file, a bad magic.
        let only = Passes::new(4, 4, PASS_DEPTH | PASS_ALBEDO);
        let mut bytes = Vec::new();
        write_passes(1, 1, &only, &mut bytes).unwrap();
        assert_eq!(bytes.len(), 32 + 16 * 4 * 4);
        assert_eq!(read_passes(&bytes).unwrap().2, only);
        assert!(read_passes(&bytes[..bytes.len() - 1]).is_none());
        bytes[0] = b'X';
        assert!(read_passes(&bytes).is_none());
        // The image's frame reads back too.
        let mut frame = Vec::new();
        r.image.write(true, &mut frame).unwrap();
        let f = Frame::read(&frame).unwrap();
        assert_eq!(
            (f.pass, f.samples, f.width, f.height, f.flags, f.rays),
            (3, 5, 3, 2, 1, 1234)
        );
        assert_eq!(f.sums, r.image.sums);
        assert!(Frame::read(&frame[..frame.len() - 4]).is_none());
    }

    /// The passes of `tests/fixtures/passes-3x2.rpp`: every plane a formula of the pixel index,
    /// the last pixel background, the one before it the floor (the page's reader checks the same).
    fn fixture_passes() -> Passes {
        let mut p = Passes::new(3, 2, PASS_ALL);
        for i in 0..6usize {
            for c in 0..3 {
                p.albedo[i * 3 + c] = i as f32 * 0.5 + c as f32 * 0.125;
                p.normal[i * 3 + c] = -(i as f32) * 0.25 + c as f32;
            }
            p.depth[i] = 100.0 + i as f32;
            p.part_id[i] = i as u32;
            p.material_id[i] = 2 * i as u32;
            p.coc[i] = i as f32 / 8.0;
        }
        p.part_id[4] = rt_core::passes::FLOOR_ID;
        p.material_id[4] = rt_core::passes::FLOOR_ID;
        p.depth[5] = f32::INFINITY;
        p
    }

    #[test]
    fn the_passes_fixture_is_what_the_launcher_writes() {
        // tests/fixtures/passes-3x2.rpp, which src/render/pass-planes.ts `parsePasses` reads in
        // tests/passes-engine.test.ts: render 42, 7 samples. REPACK_WRITE_FIXTURES=1 rewrites it.
        let mut bytes = Vec::new();
        write_passes(42, 7, &fixture_passes(), &mut bytes).unwrap();
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/passes-3x2.rpp"
        );
        if std::env::var_os("REPACK_WRITE_FIXTURES").is_some() {
            fs::write(path, &bytes).unwrap();
        }
        assert_eq!(fs::read(path).expect("the fixture"), bytes);
        assert_eq!(read_passes(&bytes).unwrap(), (42, 7, fixture_passes()));
    }

    #[test]
    fn the_store_keeps_the_last_few_and_spills_large_ones_to_the_disk() {
        let dir = crate::test_dir("kept").join("cache").join("ai");
        fs::create_dir_all(&dir).unwrap();
        // What a previous launch left: removed; anything else in the folder stays.
        for stale in ["1.rpx", "1.rpp", "7.tmp"] {
            fs::write(dir.join(stale), b"old").unwrap();
        }
        fs::write(dir.join("notes.txt"), b"keep me").unwrap();
        // In memory up to 600 bytes: a 4x4 render with every pass (16 * 4 * 4 + 48 bytes of image,
        // 16 * 10 * 4 of passes) is larger.
        let kept = Kept::new(
            KeepLimits {
                renders: 3,
                in_memory: 600,
            },
            Some(dir.clone()),
        );
        assert!(!dir.join("1.rpx").exists() && !dir.join("7.tmp").exists());
        assert!(dir.join("notes.txt").exists());

        kept.keep(render(1, 2, 2, PASS_DEPTH)); // small: memory
        kept.keep(render(2, 4, 4, PASS_ALL)); // large: disk
        assert!(!kept.on_disk(1) && kept.on_disk(2));
        assert!(dir.join("2.rpx").exists() && dir.join("2.rpp").exists());
        assert!(!dir.join("1.rpx").exists());
        // Both read back the same, from memory and from the disk.
        for (id, w, mask) in [(1, 2, PASS_DEPTH), (2, 4, PASS_ALL)] {
            let want = render(id, w, w, mask);
            let got = kept.get(id).unwrap();
            assert_eq!(got.passes, want.passes);
            assert_eq!(got.image.sums, want.image.sums);
            // The look stays with the render, on the disk too (the AI sees the image through it).
            assert_eq!(got.look, want.look, "render {id}");
            assert_eq!(got.image.samples, 5);
            let file = body(kept.passes_body(id).unwrap());
            let mut expected = Vec::new();
            write_passes(id, 5, &want.passes, &mut expected).unwrap();
            assert_eq!(file, expected, "render {id}");
        }
        // A body opened before an eviction is served whole.
        let open = kept.passes_body(2).unwrap();
        kept.keep(render(3, 2, 2, PASS_DEPTH));
        kept.keep(render(4, 2, 2, PASS_DEPTH));
        kept.keep(render(5, 4, 4, PASS_ALL));
        assert_eq!(kept.ids(), [3, 4, 5], "the oldest went first");
        assert!(kept.get(1).is_none() && kept.get(2).is_none());
        assert!(kept.passes_body(2).is_none());
        assert!(
            !dir.join("2.rpx").exists() && !dir.join("2.rpp").exists(),
            "its files too"
        );
        assert_eq!(read_passes(&body(open)).unwrap().0, 2);
        assert!(dir.join("5.rpp").exists());
        // Keeping an id again replaces it.
        kept.keep(render(4, 2, 2, PASS_ALL));
        assert_eq!(kept.ids(), [3, 5, 4]);
        // Without a folder everything stays in memory.
        let memory = Kept::new(
            KeepLimits {
                renders: 1,
                in_memory: 0,
            },
            None,
        );
        memory.keep(render(8, 4, 4, PASS_ALL));
        assert!(!memory.on_disk(8) && memory.get(8).is_some());
        assert_eq!(
            KeepLimits::default(),
            KeepLimits {
                renders: KEEP_RENDERS,
                in_memory: KEEP_IN_MEMORY
            }
        );
    }
}

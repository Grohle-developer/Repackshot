//! The native renderer behind `/api/render`: `rt-core` on every thread of the machine.
//!
//! It renders exactly as `rt` does (`rt_cli::render_progressive`): the image cut into 32-pixel
//! tiles (`tile_grid`), each with its own film, passes of 1, 2, 4, 8, then 16 sample indices over
//! every tile, tiles claimed from one atomic counter, and a tile's samples always added in index
//! order. Since `rt-core` draws its random numbers from (seed, pixel, sample index) only, the
//! film is the same bits as `rt`'s and as the browser's worker pool for the same RSB, whatever
//! the thread count (`tests/parity.rs` checks it against `rt` and the pinned hash).
//!
//! After every pass the accumulated film is published as RGBA sums: per pixel the sums of the
//! premultiplied radiance and of the coverage over the samples so far, in `f32`, which is what
//! the page's accumulator holds (`src/render/tiles.ts`), so its display and 8-bit code is reused
//! unchanged. Every pixel has the same number of samples at the end of a pass.
//!
//! Jobs: a **final** job (Render) has priority, and finals run one at a time, in the order they
//! came. A viewport job that asked for a **share** of the threads keeps rendering on that many
//! threads while a final runs (the final takes the rest, and all of them again when no live
//! viewport is left); one without a share pauses between tiles until the finals are over. Which
//! threads render a tile never changes its pixels, so the final image is the same bits either
//! way. A new **viewport** job of a client replaces that client's previous one (an older one that
//! arrives late is refused); an update without `MESH` sections keeps the previous job's meshes and
//! their BVHs (`Scene::update_from_rsb`), so moving the camera does not send or rebuild the
//! geometry. A job nobody asks about for a while (its page went away) stops by itself, and a
//! render that panics ends as failed instead of keeping its page waiting.
//!
//! **Passes** (X2, `rt_core::passes`): a final job may ask for the exact passes (`RNDR.passes`
//! of its RSB, and `passes=` of `/api/render`). They are rendered next to the image, tile by
//! tile (the exact planes in the first pass, an albedo ray after every sample) by whichever
//! threads render the tile, never change a pixel of it, and when the job ends with all its
//! samples (not cancelled, orphaned or failed) the image and the passes go to the store of
//! [`crate::kept`] before the job says it is done, so they are there for whoever reads the end.
//! Viewport jobs never render passes.

use crate::kept::{KeepLimits, Kept, KeptRender, Look, PassesBody};
use rt_core::caustics::{Photon, PhotonMap};
use rt_core::image::Film;
use rt_core::integrator::Prepared;
use rt_core::passes::{PassFilm, Passes, PASS_ALL};
use rt_core::render::{render_tile_albedo, render_tile_exact, render_tile_photons, tile_grid};
use rt_core::scene::{Scene, DENOISE_IMAGE, DENOISE_KEEP_NOISY};
use rt_core::simd::Isa;
use rt_post::denoise::{denoise_rows, DenoiseInput, GUIDE_PASSES};
use std::collections::{HashMap, VecDeque};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Edge of the square tiles (`rt_cli::TILE_SIZE`).
pub const TILE_SIZE: u32 = 32;
/// Most samples per tile in one pass (`rt_cli::MAX_PASS_SAMPLES`).
pub const MAX_PASS_SAMPLES: u32 = 16;
/// Samples when the scene's `RNDR.max_samples` is 0 (as `rt`).
pub const DEFAULT_SAMPLES: u32 = 16;
/// Viewport clients (windows) served at once.
pub const MAX_CLIENTS: usize = 8;
/// Finished final jobs kept for their pages to collect.
pub const KEEP_FINISHED: usize = 2;
/// A viewport job nobody has asked about for this long stops (the page polls it every second).
pub const ORPHAN_VIEWPORT: Duration = Duration::from_secs(10);
/// A final job nobody has asked about for this long stops (its page went away).
pub const ORPHAN_FINAL: Duration = Duration::from_secs(20);
/// How long a new viewport job waits for the previous one to stop before leaving it behind.
pub const STOP_WAIT: Duration = Duration::from_secs(5);
/// With every window slot taken, one whose page has not asked about its job for this long (a page in
/// use asks every second) gives its slot to a new window: a reloaded page, whose old self never
/// comes back, cannot keep the new one out.
pub const GONE_CLIENT: Duration = Duration::from_secs(3);

/// How long jobs and windows may go unasked (see the constants of the same names).
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// [`ORPHAN_VIEWPORT`].
    pub orphan_viewport: Duration,
    /// [`ORPHAN_FINAL`].
    pub orphan_final: Duration,
    /// [`STOP_WAIT`].
    pub stop_wait: Duration,
    /// [`GONE_CLIENT`].
    pub gone_client: Duration,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            orphan_viewport: ORPHAN_VIEWPORT,
            orphan_final: ORPHAN_FINAL,
            stop_wait: STOP_WAIT,
            gone_client: GONE_CLIENT,
        }
    }
}

/// The frame header magic.
pub const FRAME_MAGIC: [u8; 4] = *b"RPX1";
/// Bytes of the frame header.
pub const FRAME_HEADER: usize = 48;
/// Frame flag: the job is over (all samples, or the time budget).
pub const FLAG_DONE: u32 = 1;
/// Frame flag: the job was cancelled or replaced.
pub const FLAG_CANCELLED: u32 = 2;
/// Frame flag: the job failed.
pub const FLAG_FAILED: u32 = 4;
/// Frame flag: a viewport job waiting for a final one.
pub const FLAG_PAUSED: u32 = 8;
/// Frame flag: the RGBA sums follow the header.
pub const FLAG_DATA: u32 = 16;
/// Frame flag: the threads are shared between a final and a live viewport (a viewport job on its
/// share, or a final leaving that share to it); the header's thread count is this job's now.
pub const FLAG_SHARED: u32 = 32;
/// Frame flag (E5b-1): the sums are denoised (`RNDR.denoise` bit 0, `rt_post::denoise`): the
/// samples' radiance filtered, the coverage as it was.
pub const FLAG_DENOISED: u32 = 64;
/// Frame flag (E5b-1): after the (denoised) sums come the sums without denoise, as many again (a
/// final of `RNDR.denoise` bit 1, in its last frame).
pub const FLAG_NOISY: u32 = 128;
/// Frame flag (E5b-1): the image has caustics from the photon map (`RNDR.caustic_photons`, and the
/// scene has something that focuses light and a light that sends photons).
pub const FLAG_CAUSTICS: u32 = 256;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// When a job stops (`src/render/schedule.ts`, UI.md §2.7 "Finish by"): after its samples,
/// at its time limit, or whichever comes first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Finish {
    /// `RNDR.max_samples` samples (0 means [`DEFAULT_SAMPLES`]); the time does not count.
    Samples,
    /// `RNDR.max_seconds`, however many samples that is.
    Time,
    /// The samples or the time, whichever comes first.
    First,
}

impl Finish {
    /// `samples`, `time` or `first`.
    pub fn parse(text: &str) -> Option<Finish> {
        match text {
            "samples" => Some(Finish::Samples),
            "time" => Some(Finish::Time),
            "first" => Some(Finish::First),
            _ => None,
        }
    }

    /// Without a choice: whichever comes first when there is a time limit, else the samples
    /// (as `renderPixels` of the page).
    pub fn default_for(max_seconds: f32) -> Finish {
        if max_seconds > 0.0 {
            Finish::First
        } else {
            Finish::Samples
        }
    }
}

/// The limits of a budget (`budgetLimits` of `schedule.ts`): samples (0: none) and milliseconds
/// (`None`: none).
pub fn limits(finish: Finish, max_samples: u32, max_seconds: f32) -> (u32, Option<f64>) {
    let samples = match finish {
        Finish::Time => 0,
        _ if max_samples == 0 => DEFAULT_SAMPLES,
        _ => max_samples,
    };
    let ms = match finish {
        Finish::Samples => None,
        _ => Some(f64::from(max_seconds.max(0.0)) * 1000.0),
    };
    (samples, ms)
}

/// The size of the next pass after `done` samples, the last pass being `previous` (`nextPass` of
/// `tiles.ts`): 1, 2, 4, 8, then 16, cut at `limit` (0: none). `None` when the samples are done.
pub fn next_pass(done: u32, previous: u32, limit: u32) -> Option<u32> {
    let size = if previous == 0 {
        1
    } else {
        (previous * 2).min(MAX_PASS_SAMPLES)
    };
    let count = if limit > 0 {
        size.min(limit.saturating_sub(done))
    } else {
        size
    };
    (count > 0).then_some(count)
}

/// Whether a time-limited job stops before a pass of `count` samples (`runPasses` of
/// `schedule.ts`): at the limit, or when that pass would end further from it than stopping now
/// (less than half of it fits). The first pass always runs.
pub fn stop_for_time(
    done: u32,
    elapsed_ms: f64,
    limit_ms: Option<f64>,
    ms_per_sample: Option<f64>,
    count: u32,
) -> bool {
    let Some(limit) = limit_ms else {
        return false;
    };
    done > 0
        && (elapsed_ms >= limit
            || ms_per_sample.is_some_and(|m| elapsed_ms + m * f64::from(count) / 2.0 > limit))
}

/// Threads a viewport keeps while a final runs, when it asks to stay live: a quarter of them, at
/// least one (what the page asks for, `src/render/native.ts`).
pub fn viewport_share(threads: usize) -> usize {
    (threads / 4).max(1)
}

/// What a job is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// The viewport (Full mode): replaced by the next one; shares the threads with finals, or
    /// pauses for them.
    Viewport,
    /// Render: priority, one at a time.
    Final,
}

impl Kind {
    /// `viewport` or `final`.
    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "viewport" => Some(Kind::Viewport),
            "final" => Some(Kind::Final),
            _ => None,
        }
    }
}

/// A published state of a job.
#[derive(Clone, Debug)]
pub struct Frame {
    /// Passes completed (0: nothing yet).
    pub pass: u32,
    /// Samples per pixel in `sums`.
    pub samples: u32,
    /// Image width.
    pub width: u32,
    /// Image height.
    pub height: u32,
    /// Seconds since the job began rendering (until it ended).
    pub seconds: f32,
    /// `FLAG_*` bits (without `FLAG_DATA`).
    pub flags: u32,
    /// The sample target.
    pub max_samples: u32,
    /// Threads rendering it now (all of them, its share while it shares, 0 while it waits).
    pub threads: u32,
    /// Rays cast so far.
    pub rays: u64,
    /// RGBA sums, `width * height * 4` (empty before the first pass); denoised with
    /// [`FLAG_DENOISED`].
    pub sums: Arc<Vec<f32>>,
    /// With [`FLAG_NOISY`]: the RGBA sums without denoise.
    pub noisy: Option<Arc<Vec<f32>>>,
}

impl Frame {
    /// True once the job will not change any more.
    pub fn finished(&self) -> bool {
        self.flags & (FLAG_DONE | FLAG_CANCELLED | FLAG_FAILED) != 0
    }

    /// The header, with `FLAG_DATA` when `data` is set.
    pub fn header(&self, data: bool) -> [u8; FRAME_HEADER] {
        let mut h = [0u8; FRAME_HEADER];
        h[0..4].copy_from_slice(&FRAME_MAGIC);
        let flags = self.flags | if data { FLAG_DATA } else { 0 };
        for (i, v) in [
            FRAME_HEADER as u32,
            self.pass,
            self.samples,
            self.width,
            self.height,
            self.seconds.to_bits(),
            flags,
            self.max_samples,
            self.threads,
        ]
        .into_iter()
        .enumerate()
        {
            h[4 + i * 4..8 + i * 4].copy_from_slice(&v.to_le_bytes());
        }
        h[40..48].copy_from_slice(&self.rays.to_le_bytes());
        h
    }

    /// Writes the header and, with `data`, the sums (and the sums without denoise, with
    /// [`FLAG_NOISY`]) as little-endian `f32`.
    pub fn write(&self, data: bool, w: &mut dyn Write) -> io::Result<()> {
        w.write_all(&self.header(data))?;
        if data {
            let mut buf = Vec::with_capacity(64 * 1024);
            let noisy = self.noisy.as_deref().map_or(&[][..], |v| &v[..]);
            for chunk in self.sums.chunks(16 * 1024).chain(noisy.chunks(16 * 1024)) {
                buf.clear();
                for v in chunk {
                    buf.extend_from_slice(&v.to_le_bytes());
                }
                w.write_all(&buf)?;
            }
        }
        Ok(())
    }

    /// Bytes [`Frame::write`] writes.
    pub fn len(&self, data: bool) -> u64 {
        let noisy = self.noisy.as_ref().map_or(0, |v| v.len() as u64);
        FRAME_HEADER as u64
            + if data {
                (self.sums.len() as u64 + noisy) * 4
            } else {
                0
            }
    }

    /// Reads what [`Frame::write`] wrote (the sums only with [`FLAG_DATA`], which the frame then
    /// does not keep among its flags), or `None` when it is not a whole frame.
    pub fn read(bytes: &[u8]) -> Option<Frame> {
        let u = |i: usize| -> Option<u32> {
            Some(u32::from_le_bytes(bytes.get(i..i + 4)?.try_into().ok()?))
        };
        if bytes.get(..4)? != FRAME_MAGIC {
            return None;
        }
        let header = u(4)? as usize;
        let (width, height, flags) = (u(16)?, u(20)?, u(28)?);
        let n = (width as usize)
            .checked_mul(height as usize)?
            .checked_mul(4)?;
        let plane = |at: usize| -> Option<Vec<f32>> {
            let data = bytes.get(at..at.checked_add(n.checked_mul(4)?)?)?;
            Some(
                data.chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect(),
            )
        };
        let sums = if flags & FLAG_DATA != 0 {
            plane(header)?
        } else {
            Vec::new()
        };
        let noisy = if flags & FLAG_DATA != 0 && flags & FLAG_NOISY != 0 {
            Some(Arc::new(plane(header.checked_add(n.checked_mul(4)?)?)?))
        } else {
            None
        };
        Some(Frame {
            pass: u(8)?,
            samples: u(12)?,
            width,
            height,
            seconds: f32::from_bits(u(24)?),
            flags: flags & !FLAG_DATA,
            max_samples: u(32)?,
            threads: u(36)?,
            rays: u64::from_le_bytes(bytes.get(40..48)?.try_into().ok()?),
            sums: Arc::new(sums),
            noisy,
        })
    }

    /// True when there are no sums yet.
    pub fn is_empty(&self) -> bool {
        self.sums.is_empty()
    }
}

struct Progress {
    /// When rendering began (a final job may wait for another first): the clock of the job.
    started: Option<Instant>,
    pass: u32,
    samples: u32,
    rays: u64,
    sums: Arc<Vec<f32>>,
    /// The sums without denoise, when they are handed out too ([`FLAG_NOISY`]).
    noisy: Option<Arc<Vec<f32>>>,
    /// [`FLAG_DENOISED`] and [`FLAG_NOISY`]: what the sums are.
    image: u32,
    /// 0, [`FLAG_PAUSED`] or [`FLAG_SHARED`]: how it renders next to the finals.
    mode: u32,
    /// Threads rendering it now.
    active: u32,
    ended: Option<(u32, f32)>,
    error: Option<String>,
}

/// A render job.
pub struct Job {
    /// Its id.
    pub id: u32,
    /// Viewport or final.
    pub kind: Kind,
    /// Image width.
    pub width: u32,
    /// Image height.
    pub height: u32,
    /// Samples to render (0: as many as the time allows).
    pub max_samples: u32,
    /// A viewport job: the threads it keeps while a final runs (0: it pauses).
    pub share: usize,
    /// The exact passes it renders next to the image (`rt_core::passes` bits; 0 for none, and
    /// always for a viewport job), kept for the AI post-processing.
    pub passes: u32,
    /// `RNDR.denoise` of its scene (E5b-1): bit 0 the frames carry the denoised image (with
    /// [`FLAG_DENOISED`]; for a final, its last frame), bit 1 a final's last frame also the one
    /// without denoise ([`FLAG_NOISY`]). The guide passes are then rendered too.
    pub denoise: u32,
    /// The time limit in milliseconds, if any.
    limit_ms: Option<f64>,
    threads: usize,
    cancel: AtomicBool,
    progress: Mutex<Progress>,
    changed: Condvar,
    /// When its page last asked about it, and how long it may go unasked.
    seen: Mutex<Instant>,
    orphan_after: Duration,
}

impl std::fmt::Debug for Job {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Job")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("width", &self.width)
            .field("height", &self.height)
            .field("max_samples", &self.max_samples)
            .field("share", &self.share)
            .field("passes", &self.passes)
            .field("denoise", &self.denoise)
            .finish_non_exhaustive()
    }
}

impl Job {
    fn new(
        id: u32,
        kind: Kind,
        scene: &Scene,
        threads: usize,
        opts: &Options,
        orphan_after: Duration,
    ) -> Job {
        let r = &scene.render;
        let finish = opts.finish.unwrap_or(Finish::default_for(r.max_seconds));
        let (max_samples, limit_ms) = limits(finish, r.max_samples, r.max_seconds);
        Job {
            id,
            kind,
            width: r.width,
            height: r.height,
            max_samples,
            share: match kind {
                Kind::Viewport => opts.share.min(threads),
                Kind::Final => 0,
            },
            passes: match kind {
                Kind::Final => (opts.passes | r.passes) & PASS_ALL,
                Kind::Viewport => 0,
            },
            denoise: r.denoise & (DENOISE_IMAGE | DENOISE_KEEP_NOISY),
            limit_ms,
            threads,
            cancel: AtomicBool::new(false),
            progress: Mutex::new(Progress {
                started: None,
                pass: 0,
                samples: 0,
                rays: 0,
                sums: Arc::new(Vec::new()),
                noisy: None,
                image: 0,
                mode: 0,
                active: threads as u32,
                ended: None,
                error: None,
            }),
            changed: Condvar::new(),
            seen: Mutex::new(Instant::now()),
            orphan_after,
        }
    }

    /// Asks the job to stop (between tiles).
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.changed.notify_all();
    }

    /// True once cancelled.
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// Its page asked about it (a poll): it is still wanted.
    pub fn touch(&self) {
        *lock(&self.seen) = Instant::now();
    }

    /// Nobody has asked about it for longer than its limit: its page went away.
    pub fn orphaned(&self) -> bool {
        self.unasked() > self.orphan_after
    }

    /// Time since its page last asked about it.
    pub fn unasked(&self) -> Duration {
        lock(&self.seen).elapsed()
    }

    fn frame_of(&self, p: &Progress) -> Frame {
        let (mut flags, seconds) = match p.ended {
            Some((flags, s)) => (flags, s),
            None => (0, p.started.map_or(0.0, |t| t.elapsed().as_secs_f32())),
        };
        if p.ended.is_none() {
            flags |= p.mode;
        }
        flags |= p.image;
        Frame {
            pass: p.pass,
            samples: p.samples,
            width: self.width,
            height: self.height,
            seconds,
            flags,
            max_samples: self.max_samples,
            threads: if p.ended.is_some() {
                self.threads as u32
            } else {
                p.active
            },
            rays: p.rays,
            sums: Arc::clone(&p.sums),
            noisy: p.noisy.clone(),
        }
    }

    /// The job as it is now.
    pub fn frame(&self) -> Frame {
        self.frame_of(&lock(&self.progress))
    }

    /// The error of a failed job.
    pub fn error(&self) -> Option<String> {
        lock(&self.progress).error.clone()
    }

    /// Waits up to `timeout` for a pass newer than `after`, the end, or a change in how it renders
    /// next to the finals (it starts or stops sharing, or waits: the page's meter says so at once),
    /// and returns the frame.
    pub fn wait_newer(&self, after: u32, timeout: Duration) -> Frame {
        let deadline = Instant::now() + timeout;
        let mut p = lock(&self.progress);
        let mode = (p.mode, p.active);
        loop {
            if p.pass > after || p.ended.is_some() || (p.mode, p.active) != mode {
                return self.frame_of(&p);
            }
            let now = Instant::now();
            if now >= deadline {
                return self.frame_of(&p);
            }
            p = self
                .changed
                .wait_timeout(p, deadline - now)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    /// How it renders next to the finals now (`0`, [`FLAG_PAUSED`] or [`FLAG_SHARED`]) and on how
    /// many threads.
    fn set_mode(&self, mode: u32, active: usize) {
        let mut p = lock(&self.progress);
        if p.mode != mode || p.active != active as u32 {
            p.mode = mode;
            p.active = active as u32;
            drop(p);
            self.changed.notify_all();
        }
    }

    /// The job for the diagnostics (`GET /api/render/state`).
    fn state_json(&self) -> String {
        use crate::json::{self, Object};
        let f = self.frame();
        let names = [
            (FLAG_DONE, "done"),
            (FLAG_CANCELLED, "cancelled"),
            (FLAG_FAILED, "failed"),
            (FLAG_PAUSED, "paused"),
            (FLAG_SHARED, "shared"),
            (FLAG_DENOISED, "denoised"),
            (FLAG_NOISY, "noisy"),
            (FLAG_CAUSTICS, "caustics"),
        ];
        let flags = names
            .iter()
            .filter(|(bit, _)| f.flags & bit != 0)
            .map(|(_, name)| json::string(name));
        Object::new()
            .num("id", f64::from(self.id))
            .str(
                "kind",
                match self.kind {
                    Kind::Viewport => "viewport",
                    Kind::Final => "final",
                },
            )
            .num("width", f64::from(self.width))
            .num("height", f64::from(self.height))
            .num("maxSamples", f64::from(self.max_samples))
            .num("share", self.share as f64)
            .num("passes", f64::from(self.passes))
            .num("denoise", f64::from(self.denoise))
            .num("threads", f64::from(f.threads))
            .num("pass", f64::from(f.pass))
            .num("samples", f64::from(f.samples))
            .num("seconds", f64::from(f.seconds))
            .raw("flags", &json::array(flags))
            .bool("cancelRequested", self.cancelled())
            .num("unaskedMs", lock(&self.seen).elapsed().as_millis() as f64)
            .opt_str("error", self.error().as_deref())
            .build()
    }

    fn end(&self, flags: u32, error: Option<String>) {
        let mut p = lock(&self.progress);
        if p.ended.is_some() {
            return;
        }
        let seconds = p.started.map_or(0.0, |t| t.elapsed().as_secs_f32());
        p.ended = Some((flags, seconds));
        p.mode = 0;
        p.error = error;
        drop(p);
        self.changed.notify_all();
    }
}

/// Runs a job's render; if it panics, the job ends as failed (instead of never ending, which would
/// keep its page waiting for ever) and the panic goes no further.
fn guarded(job: &Job, render: impl FnOnce()) {
    if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(render)) {
        let why = e
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| e.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_string());
        crate::log!("render job {} failed: {why}", job.id);
        job.end(FLAG_FAILED, Some(why));
    }
}

/// Final jobs run one at a time, in order; viewport jobs share the threads with them or wait.
#[derive(Default)]
struct Gate {
    state: Mutex<GateState>,
    changed: Condvar,
}

#[derive(Default)]
struct GateState {
    queue: VecDeque<u32>,
    running: u32,
    /// Threads kept by live viewport jobs (those with a share) while they render.
    live: usize,
}

impl GateState {
    fn final_busy(&self) -> bool {
        self.running > 0 || !self.queue.is_empty()
    }
}

/// A final's turn at the gate: the next final goes when it is dropped, even after a panic.
struct FinalTurn<'a> {
    gate: &'a Gate,
}

impl Drop for FinalTurn<'_> {
    fn drop(&mut self) {
        let mut s = lock(&self.gate.state);
        s.running = s.running.saturating_sub(1);
        drop(s);
        self.gate.changed.notify_all();
    }
}

/// A live viewport job's share of the threads, kept from the finals while it renders.
struct LiveShare<'a> {
    gate: &'a Gate,
    threads: usize,
}

impl Drop for LiveShare<'_> {
    fn drop(&mut self) {
        let mut s = lock(&self.gate.state);
        s.live = s.live.saturating_sub(self.threads);
        drop(s);
        self.gate.changed.notify_all();
    }
}

impl Gate {
    fn wait<'a>(&self, s: MutexGuard<'a, GateState>, ms: u64) -> MutexGuard<'a, GateState> {
        self.changed
            .wait_timeout(s, Duration::from_millis(ms))
            .unwrap_or_else(PoisonError::into_inner)
            .0
    }

    /// Waits for `job`'s turn; `None` if it was cancelled first (or its page went away).
    fn enter_final(&self, job: &Job) -> Option<FinalTurn<'_>> {
        let mut s = lock(&self.state);
        s.queue.push_back(job.id);
        loop {
            if job.orphaned() {
                job.cancel();
            }
            if job.cancelled() {
                s.queue.retain(|&id| id != job.id);
                drop(s);
                self.changed.notify_all();
                return None;
            }
            if s.running == 0 && s.queue.front() == Some(&job.id) {
                s.queue.pop_front();
                s.running += 1;
                return Some(FinalTurn { gate: self });
            }
            s = self.wait(s, 100);
        }
    }

    /// A viewport job with a share starts rendering: the finals leave it that many threads.
    fn live(&self, threads: usize) -> LiveShare<'_> {
        lock(&self.state).live += threads;
        self.changed.notify_all();
        LiveShare {
            gate: self,
            threads,
        }
    }

    /// Before a viewport tile of thread `worker`: without a final, every thread goes; while one
    /// runs, the job's share goes on and the other threads wait (all of them without a share).
    /// False when `job` was cancelled, or when a waiting thread finds the pass has no tile left
    /// (`over`): the threads that go finish it.
    fn viewport_turn(&self, job: &Job, worker: usize, over: &dyn Fn() -> bool) -> bool {
        let mut s = lock(&self.state);
        let mut waited = false;
        loop {
            let busy = s.final_busy();
            // The first thread speaks for the job: paused, sharing, or on all its threads.
            if worker == 0 {
                match (busy, job.share) {
                    (false, _) => job.set_mode(0, job.threads),
                    (true, 0) => job.set_mode(FLAG_PAUSED, 0),
                    (true, n) => job.set_mode(FLAG_SHARED, n),
                }
            }
            if job.cancelled() || (waited && over()) {
                return false;
            }
            if !busy || worker < job.share {
                return true;
            }
            waited = true;
            s = self.wait(s, 50);
        }
    }

    /// Before a final tile of thread `worker`: every thread but those kept by live viewports
    /// (always at least one). False when `job` was cancelled, or when a waiting thread finds the
    /// pass has no tile left (`over`).
    fn final_turn(&self, job: &Job, worker: usize, over: &dyn Fn() -> bool) -> bool {
        let mut s = lock(&self.state);
        let mut waited = false;
        loop {
            let kept = s.live.min(job.threads.saturating_sub(1));
            let allowed = job.threads - kept;
            if worker == 0 {
                job.set_mode(if kept > 0 { FLAG_SHARED } else { 0 }, allowed);
            }
            if job.cancelled() || (waited && over()) {
                return false;
            }
            if worker < allowed {
                return true;
            }
            waited = true;
            s = self.wait(s, 50);
        }
    }
}

/// The sums of the squared luminance of the tile films (`Film::lum2`), for the denoiser.
fn lum2_of(films: &[Mutex<Film>], width: u32, height: u32) -> Vec<f32> {
    let mut out = vec![0.0f32; width as usize * height as usize];
    for film in films {
        let f = lock(film);
        for ly in 0..f.height {
            let i = (f.origin_y + ly) as usize * width as usize + f.origin_x as usize;
            let j = (ly * f.width) as usize;
            out[i..i + f.width as usize].copy_from_slice(&f.lum2[j..j + f.width as usize]);
        }
    }
    out
}

/// The passes of the tile films so far, assembled.
fn passes_of(films: &[Mutex<PassFilm>], width: u32, height: u32, mask: u32) -> Passes {
    let mut passes = Passes::new(width, height, mask);
    for film in films {
        let f = lock(film);
        passes.copy_region(f.origin_x, f.origin_y, &f.resolve());
    }
    passes
}

/// Bands of rows a denoise of `height` rows is cut into on `threads` threads: no band under 192
/// rows (each holds `rt_post::denoise::HALO` rows around it).
fn denoise_bands(height: u32, threads: usize) -> u32 {
    (height / 192).clamp(1, threads.max(1) as u32)
}

/// Denoises the RGBA `sums` of `samples` samples with their `lum2` and guide `passes`, in bands
/// on `threads` threads (each band exactly those rows of the whole image: the same bits for any
/// thread count, as the web pool's).
fn denoise_sums(
    sums: &[f32],
    lum2: &[f32],
    passes: &Passes,
    samples: u32,
    threads: usize,
) -> Option<Vec<f32>> {
    let whole = DenoiseInput::whole(samples, sums, lum2, passes).ok()?;
    let h = passes.height;
    let bands = denoise_bands(h, threads);
    let parts: Vec<Option<Vec<f32>>> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..bands)
            .map(|k| {
                let (y0, y1) = (h * k / bands, h * (k + 1) / bands);
                let band = whole.with_halo(y0, y1);
                scope.spawn(move || denoise_rows(&band, y0, y1).ok())
            })
            .collect();
        workers
            .into_iter()
            .map(|w| w.join().ok().flatten())
            .collect()
    });
    let mut out = Vec::with_capacity(sums.len());
    for part in parts {
        out.extend(part?);
    }
    Some(out)
}

/// The photon maps of samples `first .. first + count` of a scene with caustics (E5b-1), each
/// traced on `threads` threads in photon ranges put back together in order: the same bits for any
/// thread count (`rt_cli::photon_maps` does the same). Returns them and their rays.
fn photon_maps(
    scene: &Scene,
    prepared: &Prepared,
    first: u32,
    count: u32,
    threads: usize,
    isa: Isa,
) -> (Vec<PhotonMap>, u64) {
    if !prepared.has_caustics() {
        return (Vec::new(), 0);
    }
    let photons = scene.render.caustic_photons;
    let threads = threads.clamp(1, photons.max(1) as usize) as u64;
    let mut maps = Vec::with_capacity(count as usize);
    let mut rays = 0;
    for sample in first..first + count {
        let parts: Vec<(Vec<Photon>, u64)> = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|k| {
                    let range = (u64::from(photons) * k / threads) as u32
                        ..(u64::from(photons) * (k + 1) / threads) as u32;
                    scope.spawn(move || PhotonMap::trace_range(scene, prepared, sample, range, isa))
                })
                .collect();
            workers
                .into_iter()
                .map(|w| w.join().unwrap_or_default())
                .collect()
        });
        let (mut all, mut map_rays) = (Vec::new(), 0);
        for (part, r) in parts {
            all.extend(part);
            map_rays += r;
        }
        rays += map_rays;
        maps.push(PhotonMap::build(prepared, sample, all, map_rays));
    }
    (maps, rays)
}

/// The RGBA sums of the tile films.
fn sums_of(films: &[Mutex<Film>], width: u32, height: u32) -> Vec<f32> {
    let mut out = vec![0.0f32; width as usize * height as usize * 4];
    for film in films {
        let f = lock(film);
        for ly in 0..f.height {
            for lx in 0..f.width {
                let j = (ly * f.width + lx) as usize;
                let i =
                    ((f.origin_y + ly) as usize * width as usize + (f.origin_x + lx) as usize) * 4;
                out[i..i + 3].copy_from_slice(&f.rgb[j * 3..j * 3 + 3]);
                out[i + 3] = f.alpha[j];
            }
        }
    }
    out
}

/// The flags a job ends with once [`render`] returns.
fn end_flags(job: &Job) -> u32 {
    if job.cancelled() {
        FLAG_CANCELLED
    } else {
        FLAG_DONE
    }
}

/// Renders `job` (the progressive loop of `rt`: the same tiles, passes and sample order), publishing
/// the sums after every pass. It stops as the page's `runPasses` does (`src/render/schedule.ts`):
/// after the samples, or between passes near the time limit; never inside a pass. Which thread
/// renders which tile (all of them, or the share left by the gate) does not change a pixel, nor
/// a pass: with `job.passes`, the exact passes of every tile come with its first pass and the
/// albedo of every sample after it, and they are returned, assembled, unless the job was
/// cancelled. A viewport's share goes back before it returns; the caller ends the job.
fn render(job: &Job, scene: &Scene, gate: &Gate, isa: Isa) -> Option<Passes> {
    let (width, height) = (job.width, job.height);
    let live = (job.kind == Kind::Viewport && job.share > 0).then(|| gate.live(job.share));
    let prepared = Prepared::new(scene);
    let tiles = tile_grid(width, height, TILE_SIZE);
    let threads = job.threads.clamp(1, tiles.len().max(1));
    let films: Vec<Mutex<Film>> = tiles
        .iter()
        .map(|t| Mutex::new(Film::region(t.x, t.y, t.w, t.h)))
        .collect();
    // The passes it keeps, and the denoiser's guides when it denoises (E5b-1).
    let denoise = job.denoise & DENOISE_IMAGE != 0;
    let mask = job.passes | if denoise { GUIDE_PASSES } else { 0 };
    let pass_films: Vec<Mutex<PassFilm>> = if mask == 0 {
        Vec::new()
    } else {
        tiles
            .iter()
            .map(|t| Mutex::new(PassFilm::region(t.x, t.y, t.w, t.h, mask)))
            .collect()
    };
    // Photon maps and denoising run on the job's threads (a sharing viewport's share).
    let side_threads = match job.kind {
        Kind::Viewport if job.share > 0 => job.share,
        _ => threads,
    };
    // The viewport's last denoised image: when, how long it took (ms), its samples and sums.
    let mut last_clean: Option<(Instant, f64, u32, Arc<Vec<f32>>)> = None;
    let caustics = if prepared.has_caustics() {
        FLAG_CAUSTICS
    } else {
        0
    };
    let t0 = Instant::now();
    lock(&job.progress).started = Some(t0);
    let ms = |t: Instant| t.duration_since(t0).as_secs_f64() * 1000.0;
    let (mut done, mut previous, mut passes, mut rays) = (0u32, 0u32, 0u32, 0u64);
    let mut ms_per_sample: Option<f64> = None;
    let (tiles, films, prepared, pass_tiles) = (&tiles, &films, &prepared, &pass_films);
    while !job.cancelled() {
        let Some(count) = next_pass(done, previous, job.max_samples) else {
            break;
        };
        let now = Instant::now();
        if stop_for_time(done, ms(now), job.limit_ms, ms_per_sample, count)
            || done > u32::MAX - 2 * MAX_PASS_SAMPLES
        {
            break;
        }
        let pass_start = Instant::now();
        let first = done;
        // Caustics (E5b-1): the photon maps of this pass's samples, before its tiles.
        let (maps, map_rays) = photon_maps(scene, prepared, first, count, side_threads, isa);
        rays += map_rays;
        let maps = &maps;
        let next_tile = AtomicUsize::new(0);
        let next_tile = &next_tile;
        // Every tile of the pass is taken: a thread waiting for its turn has nothing left to do.
        let over = || next_tile.load(Ordering::Relaxed) >= tiles.len();
        let over = &over;
        let pass_rays: u64 = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|worker| {
                    scope.spawn(move || {
                        let mut rays = 0u64;
                        loop {
                            // The page that wanted it went away: it stops.
                            if job.orphaned() {
                                job.cancel();
                            }
                            let go = match job.kind {
                                Kind::Viewport => gate.viewport_turn(job, worker, over),
                                Kind::Final => gate.final_turn(job, worker, over),
                            };
                            if !go {
                                break;
                            }
                            let i = next_tile.fetch_add(1, Ordering::Relaxed);
                            let (Some(&tile), Some(film)) = (tiles.get(i), films.get(i)) else {
                                // The last tile is taken: the waiting threads can leave the pass.
                                gate.changed.notify_all();
                                break;
                            };
                            let mut film = lock(film);
                            let mut passes = pass_tiles.get(i).map(lock);
                            if let (Some(passes), 0) = (passes.as_deref_mut(), first) {
                                rays += render_tile_exact(scene, prepared, tile, passes, isa);
                            }
                            for sample in first..first + count {
                                let map = maps.get((sample - first) as usize);
                                rays += render_tile_photons(
                                    scene, prepared, map, tile, sample, &mut film, isa,
                                );
                                if let Some(passes) = passes.as_deref_mut() {
                                    rays += render_tile_albedo(
                                        scene, prepared, tile, sample, passes, isa,
                                    );
                                }
                            }
                        }
                        rays
                    })
                })
                .collect();
            workers.into_iter().map(|w| w.join().unwrap_or(0)).sum()
        });
        if job.cancelled() {
            // Some tiles may have this pass and others not: it is never published.
            break;
        }
        ms_per_sample = Some(
            Instant::now().duration_since(pass_start).as_secs_f64() * 1000.0 / f64::from(count),
        );
        rays += pass_rays;
        done += count;
        previous = count;
        passes += 1;
        let sums = Arc::new(sums_of(films, width, height));
        // A viewport that denoises shows the denoised image: after its first and last passes,
        // and after any other one once three times the last denoise has gone by (in between, the
        // last denoised image at the samples it has now).
        let (shown, image) = if denoise && job.kind == Kind::Viewport {
            let last_pass = next_pass(done, previous, job.max_samples).is_none();
            let due = last_clean.as_ref().is_none_or(|(at, took, _, _)| {
                last_pass || at.elapsed().as_secs_f64() * 1000.0 >= 3.0 * took
            });
            let fresh = if due {
                let t = Instant::now();
                let clean = denoise_sums(
                    &sums,
                    &lum2_of(films, width, height),
                    &passes_of(pass_tiles, width, height, mask),
                    done,
                    side_threads,
                );
                clean.map(|c| {
                    let c = Arc::new(c);
                    let took = t.elapsed().as_secs_f64() * 1000.0;
                    last_clean = Some((Instant::now(), took, done, Arc::clone(&c)));
                    c
                })
            } else {
                last_clean.as_ref().map(|(_, _, n, clean)| {
                    let k = done as f32 / *n as f32;
                    Arc::new(
                        clean
                            .iter()
                            .zip(sums.iter())
                            .enumerate()
                            .map(|(i, (&c, &a))| if i % 4 == 3 { a } else { c * k })
                            .collect(),
                    )
                })
            };
            match fresh {
                Some(clean) => (clean, FLAG_DENOISED),
                None => (sums, 0),
            }
        } else {
            (sums, 0)
        };
        {
            let mut p = lock(&job.progress);
            p.pass = passes;
            p.samples = done;
            p.rays = rays;
            p.sums = shown;
            p.image = image | caustics;
        }
        job.changed.notify_all();
    }
    // The share goes back before the job says it ended.
    drop(live);
    if job.cancelled() {
        return None;
    }
    // A final that denoises: one more frame, its last, with the denoised image (and the one
    // without denoise when it asks for both), before it is kept and says it ended.
    if denoise && job.kind == Kind::Final && done > 0 {
        let sums = sums_of(films, width, height);
        let clean = denoise_sums(
            &sums,
            &lum2_of(films, width, height),
            &passes_of(pass_tiles, width, height, mask),
            done,
            threads,
        );
        if let Some(clean) = clean {
            let keep = job.denoise & DENOISE_KEEP_NOISY != 0;
            let mut p = lock(&job.progress);
            p.pass = passes + 1;
            p.sums = Arc::new(clean);
            p.image = FLAG_DENOISED | caustics | if keep { FLAG_NOISY } else { 0 };
            p.noisy = keep.then(|| Arc::new(sums));
            drop(p);
            job.changed.notify_all();
        }
    }
    if pass_films.is_empty() || job.passes == 0 {
        return None;
    }
    // Each tile's film is dropped once copied, so a large image does not hold its passes twice;
    // only the passes the job keeps (not the denoiser's guides).
    let mut kept = Passes::new(width, height, job.passes);
    for film in pass_films {
        let f = film.into_inner().unwrap_or_else(PoisonError::into_inner);
        kept.copy_region(f.origin_x, f.origin_y, &f.resolve());
    }
    Some(kept)
}

/// Why a job was not started.
#[derive(Debug, PartialEq, Eq)]
pub enum SubmitError {
    /// The RSB is not valid.
    BadScene(String),
    /// An update (not marked as a whole scene, and without `MESH` sections), but this client's
    /// meshes are not loaded (or are other meshes): send the whole scene.
    NeedMeshes,
    /// Too many viewport clients.
    Busy,
    /// A viewport job older (by its `seq`) than the client's last one: it arrived late and would
    /// replace a newer view.
    Stale,
}

/// How a job is to run, besides its scene.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Options {
    /// When it stops (`None`: [`Finish::default_for`] its time limit).
    pub finish: Option<Finish>,
    /// A viewport job: the threads it keeps while a final runs (0: it pauses for finals).
    pub share: usize,
    /// A viewport job: its number in the client's order of views; one not newer than the
    /// client's last is refused ([`SubmitError::Stale`]).
    pub seq: Option<u64>,
    /// A final job: the exact passes to render next to the image besides its `RNDR.passes`
    /// (`rt_core::passes` bits; X2). A viewport job renders none.
    pub passes: u32,
}

/// True when the RSB has a `MESH` section.
pub fn has_meshes(bytes: &[u8]) -> bool {
    if bytes.len() < 8 || bytes[..4] != *b"RSB1" {
        return false;
    }
    let header = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let mut pos = 8usize.saturating_add(header);
    while let Some(head) = pos.checked_add(8).and_then(|end| bytes.get(pos..end)) {
        if head[..4] == *b"MESH" {
            return true;
        }
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        match pos.checked_add(8 + len) {
            Some(next) => pos = next,
            None => return false,
        }
    }
    false
}

#[derive(Default)]
struct Viewport {
    mesh_key: String,
    scene: Option<Scene>,
    running: Option<(Arc<Job>, JoinHandle<Scene>)>,
    /// The `seq` of the client's last viewport job.
    last_seq: u64,
}

impl Viewport {
    /// Stops the running job (if any) and takes its scene back. A job that does not stop within
    /// `wait` (a tile that takes for ever) is left to end on its own, without its scene: the
    /// next update then asks for the whole scene instead of waiting for it.
    fn stop(&mut self, wait: Duration) {
        if let Some((job, handle)) = self.running.take() {
            job.cancel();
            let deadline = Instant::now() + wait;
            while !handle.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(1));
            }
            if handle.is_finished() {
                self.scene = handle.join().ok();
            } else {
                crate::log!(
                    "viewport job {} did not stop in {} s; left behind",
                    job.id,
                    wait.as_secs()
                );
                self.scene = None;
            }
        }
    }

    fn idle(&self) -> bool {
        self.running
            .as_ref()
            .is_none_or(|(job, _)| job.frame().finished())
    }

    /// Time since its page last asked about its job (none: never).
    fn unasked(&self) -> Duration {
        self.running
            .as_ref()
            .map_or(Duration::MAX, |(job, _)| job.unasked())
    }
}

struct Inner {
    threads: usize,
    isa: Isa,
    gate: Gate,
    next_id: AtomicU32,
    jobs: Mutex<HashMap<u32, Arc<Job>>>,
    finished: Mutex<VecDeque<u32>>,
    viewports: Mutex<HashMap<String, Viewport>>,
    limits: Limits,
    kept: Kept,
}

/// The renderer: jobs, their threads and their priority.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

impl Engine {
    /// An engine rendering on `threads` threads (0: every hardware thread).
    pub fn new(threads: usize) -> Engine {
        Engine::with_limits(threads, Limits::default())
    }

    /// [`Engine::new`] with other limits: how long a viewport or a final job may go unasked
    /// before it stops, how long a new viewport job waits for the previous one to stop, and how
    /// long a window may go unasked before a new one takes its slot. The passes of its final
    /// renders are kept in memory only.
    pub fn with_limits(threads: usize, limits: Limits) -> Engine {
        Engine::with_store(threads, limits, KeepLimits::default(), None)
    }

    /// [`Engine::with_limits`] keeping final renders with passes within `keep`, spilling large
    /// ones into `cache` (`<data>/cache/ai`; its files of a previous launch are removed now).
    pub fn with_store(
        threads: usize,
        limits: Limits,
        keep: KeepLimits,
        cache: Option<PathBuf>,
    ) -> Engine {
        let threads = if threads == 0 {
            std::thread::available_parallelism().map_or(1, |n| n.get())
        } else {
            threads
        };
        Engine {
            inner: Arc::new(Inner {
                threads,
                isa: Isa::detect(),
                gate: Gate::default(),
                next_id: AtomicU32::new(1),
                jobs: Mutex::new(HashMap::new()),
                finished: Mutex::new(VecDeque::new()),
                viewports: Mutex::new(HashMap::new()),
                limits,
                kept: Kept::new(keep, cache),
            }),
        }
    }

    /// The kept image and passes of final render `id` (read back from the cache folder when they
    /// are there), for the AI post-processing.
    pub fn kept(&self, id: u32) -> Option<KeptRender> {
        self.inner.kept.get(id)
    }

    /// The passes file of final render `id`, to serve.
    pub fn kept_passes(&self, id: u32) -> Option<PassesBody> {
        self.inner.kept.passes_body(id)
    }

    /// The ids of the kept renders, oldest first.
    pub fn kept_ids(&self) -> Vec<u32> {
        self.inner.kept.ids()
    }

    /// True when final render `id` is kept in the cache folder rather than in memory.
    pub fn kept_on_disk(&self, id: u32) -> bool {
        self.inner.kept.on_disk(id)
    }

    /// Threads rendering a job.
    pub fn threads(&self) -> usize {
        self.inner.threads
    }

    /// The SIMD path in use.
    pub fn isa(&self) -> Isa {
        self.inner.isa
    }

    /// A job by id.
    pub fn job(&self, id: u32) -> Option<Arc<Job>> {
        lock(&self.inner.jobs).get(&id).cloned()
    }

    /// Cancels a job and forgets it. False when there is no such job.
    pub fn cancel(&self, id: u32) -> bool {
        let job = lock(&self.inner.jobs).remove(&id);
        match job {
            Some(job) => {
                job.cancel();
                self.inner.gate.changed.notify_all();
                true
            }
            None => false,
        }
    }

    fn register(&self, job: &Arc<Job>) {
        lock(&self.inner.jobs).insert(job.id, Arc::clone(job));
    }

    /// Starts a job from RSB bytes, taking them for a whole scene when they have a `MESH`
    /// section and for an update otherwise (see [`Engine::submit_scene`]; a scene without meshes
    /// has to say that it is whole).
    pub fn submit(
        &self,
        kind: Kind,
        rsb: &[u8],
        mesh_key: &str,
        client: &str,
        finish: Option<Finish>,
    ) -> Result<Arc<Job>, SubmitError> {
        self.submit_scene(kind, rsb, has_meshes(rsb), mesh_key, client, finish)
    }

    /// Starts a job from RSB bytes. `whole` says the bytes are the complete scene, so it is read
    /// with `Scene::from_rsb` even when it has no `MESH` section (an empty project: a studio with
    /// no model); otherwise they are an update of the scene this client loaded before, which a
    /// final job never takes. `mesh_key` names the geometry (an update must name the meshes it
    /// expects); `client` tells viewport jobs of different windows apart; `finish` is when it
    /// stops (`None`: [`Finish::default_for`] its time limit).
    pub fn submit_scene(
        &self,
        kind: Kind,
        rsb: &[u8],
        whole: bool,
        mesh_key: &str,
        client: &str,
        finish: Option<Finish>,
    ) -> Result<Arc<Job>, SubmitError> {
        let opts = Options {
            finish,
            ..Options::default()
        };
        self.submit_with(kind, rsb, whole, mesh_key, client, opts)
    }

    /// [`Engine::submit_scene`] with every option: a viewport job's share of the threads while a
    /// final runs, and its place in the client's order (`seq`).
    pub fn submit_with(
        &self,
        kind: Kind,
        rsb: &[u8],
        whole: bool,
        mesh_key: &str,
        client: &str,
        opts: Options,
    ) -> Result<Arc<Job>, SubmitError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        match kind {
            Kind::Final => {
                if !whole {
                    return Err(SubmitError::NeedMeshes);
                }
                let scene =
                    Scene::from_rsb(rsb).map_err(|e| SubmitError::BadScene(e.to_string()))?;
                let job = Arc::new(Job::new(
                    id,
                    kind,
                    &scene,
                    self.inner.threads,
                    &opts,
                    self.inner.limits.orphan_final,
                ));
                self.register(&job);
                let (engine, run) = (self.clone(), Arc::clone(&job));
                std::thread::spawn(move || {
                    let inner = &engine.inner;
                    match inner.gate.enter_final(&run) {
                        Some(turn) => {
                            let mut turn = Some(turn);
                            guarded(&run, || {
                                let passes = render(&run, &scene, &inner.gate, inner.isa);
                                // The next final may start while this one's passes are kept.
                                drop(turn.take());
                                // Kept before the job says it is done (whoever sees the end finds
                                // them), and only for a final that rendered all it was to render.
                                if let (Some(passes), false) = (passes, run.cancelled()) {
                                    let mut image = run.frame();
                                    image.flags = FLAG_DONE;
                                    inner.kept.keep(KeptRender {
                                        id: run.id,
                                        image,
                                        passes: Arc::new(passes),
                                        look: Look {
                                            tonemap: scene.render.tonemap,
                                            exposure_ev: scene.render.exposure_ev,
                                        },
                                    });
                                }
                                run.end(end_flags(&run), None);
                            });
                            drop(turn);
                        }
                        None => run.end(FLAG_CANCELLED, None),
                    }
                    let mut finished = lock(&inner.finished);
                    finished.push_back(run.id);
                    while finished.len() > KEEP_FINISHED {
                        if let Some(old) = finished.pop_front() {
                            lock(&inner.jobs).remove(&old);
                        }
                    }
                });
                Ok(job)
            }
            Kind::Viewport => {
                let mut viewports = lock(&self.inner.viewports);
                if !viewports.contains_key(client) && viewports.len() >= MAX_CLIENTS {
                    // Windows with nothing rendering go first; then the one whose page has gone
                    // longest without asking, if it is longer than a page in use ever waits (a
                    // reloaded page's old self): reloads alone never keep a new window out.
                    let idle: Vec<String> = viewports
                        .iter()
                        .filter(|(_, v)| v.idle())
                        .map(|(k, _)| k.clone())
                        .collect();
                    for k in idle {
                        viewports.remove(&k);
                    }
                    if viewports.len() >= MAX_CLIENTS {
                        let gone = viewports
                            .iter()
                            .map(|(k, v)| (v.unasked(), k.clone()))
                            .filter(|(unasked, _)| *unasked > self.inner.limits.gone_client)
                            .max();
                        if let Some((_, k)) = gone {
                            if let Some(mut slot) = viewports.remove(&k) {
                                if let Some((old, _)) = &slot.running {
                                    lock(&self.inner.jobs).remove(&old.id);
                                }
                                slot.stop(self.inner.limits.stop_wait);
                            }
                        }
                    }
                    if viewports.len() >= MAX_CLIENTS {
                        return Err(SubmitError::Busy);
                    }
                }
                let slot = viewports.entry(client.to_string()).or_default();
                // A view that arrived after a newer one (two requests overtaking each other) must
                // not replace it.
                // (Its number counts once the job is accepted: a refused update is sent again
                // whole with the same number.)
                if opts.seq.is_some_and(|seq| seq <= slot.last_seq) {
                    return Err(SubmitError::Stale);
                }
                if let Some((old, _)) = &slot.running {
                    lock(&self.inner.jobs).remove(&old.id);
                }
                slot.stop(self.inner.limits.stop_wait);
                let scene = if whole {
                    let scene =
                        Scene::from_rsb(rsb).map_err(|e| SubmitError::BadScene(e.to_string()))?;
                    slot.mesh_key = mesh_key.to_string();
                    scene
                } else {
                    match slot.scene.take() {
                        Some(mut scene) if slot.mesh_key == mesh_key => {
                            if let Err(e) = scene.update_from_rsb(rsb) {
                                slot.scene = Some(scene);
                                return Err(SubmitError::BadScene(e.to_string()));
                            }
                            scene
                        }
                        other => {
                            slot.scene = other;
                            return Err(SubmitError::NeedMeshes);
                        }
                    }
                };
                if let Some(seq) = opts.seq {
                    slot.last_seq = seq;
                }
                let job = Arc::new(Job::new(
                    id,
                    kind,
                    &scene,
                    self.inner.threads,
                    &opts,
                    self.inner.limits.orphan_viewport,
                ));
                self.register(&job);
                let (engine, run) = (self.clone(), Arc::clone(&job));
                let handle = std::thread::spawn(move || {
                    guarded(&run, || {
                        render(&run, &scene, &engine.inner.gate, engine.inner.isa);
                        run.end(end_flags(&run), None);
                    });
                    scene
                });
                slot.running = Some((Arc::clone(&job), handle));
                Ok(job)
            }
        }
    }

    /// What the renderer is doing now, as JSON (`GET /api/render/state`, and the log when the
    /// page's viewport watchdog fires): the gate, every job and every window's viewport.
    pub fn state_json(&self) -> String {
        use crate::json::{self, Object};
        let inner = &self.inner;
        let gate = {
            let s = lock(&inner.gate.state);
            Object::new()
                .num("finalsRunning", f64::from(s.running))
                .raw(
                    "finalsWaiting",
                    &json::array(s.queue.iter().map(|id| id.to_string())),
                )
                .num("liveViewportThreads", s.live as f64)
                .build()
        };
        let mut jobs: Vec<Arc<Job>> = lock(&inner.jobs).values().cloned().collect();
        jobs.sort_by_key(|j| j.id);
        let viewports: Vec<String> = {
            let v = lock(&inner.viewports);
            let mut list: Vec<(&String, &Viewport)> = v.iter().collect();
            list.sort_by(|a, b| a.0.cmp(b.0));
            list.iter()
                .map(|(client, slot)| {
                    // A prefix of the window's id is enough to tell windows apart.
                    let short: String = client.chars().take(6).collect();
                    let running = slot.running.as_ref().map(|(job, handle)| {
                        Object::new()
                            .num("id", f64::from(job.id))
                            .bool("threadDone", handle.is_finished())
                            .build()
                    });
                    Object::new()
                        .str("client", &short)
                        .num("lastSeq", slot.last_seq as f64)
                        .bool("sceneKept", slot.scene.is_some())
                        .raw("running", running.as_deref().unwrap_or("null"))
                        .build()
                })
                .collect()
        };
        Object::new()
            .num("threads", inner.threads as f64)
            .str("isa", inner.isa.name())
            .raw("gate", &gate)
            .raw("jobs", &json::array(jobs.iter().map(|j| j.state_json())))
            .raw("viewports", &json::array(viewports))
            .build()
    }

    /// Stops every job (the application is closing).
    pub fn shutdown(&self) {
        for job in lock(&self.inner.jobs).values() {
            job.cancel();
        }
        for slot in lock(&self.inner.viewports).values_mut() {
            slot.stop(self.inner.limits.stop_wait);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_example(samples: u32, w: u32, h: u32) -> Scene {
        let mut scene = rt_core::example::scene();
        scene.render.width = w;
        scene.render.height = h;
        scene.render.max_samples = samples;
        scene
    }

    /// Tests that time their renders, or start many threads, run one at a time (side by side they would
    /// starve each other's clocks on a small machine).
    fn serial() -> MutexGuard<'static, ()> {
        static SERIAL: Mutex<()> = Mutex::new(());
        lock(&SERIAL)
    }

    fn wait_done(job: &Job) -> Frame {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            let f = job.wait_newer(u32::MAX - 1, Duration::from_millis(200));
            if f.finished() {
                return f;
            }
            assert!(Instant::now() < deadline, "job {} did not finish", job.id);
        }
    }

    #[test]
    fn finds_mesh_sections() {
        let scene = small_example(1, 8, 8);
        let rsb = scene.to_rsb();
        assert!(has_meshes(&rsb));
        assert!(!has_meshes(b"RSB1\0\0\0\0"));
        assert!(!has_meshes(b"XXXX\0\0\0\0MESH\0\0\0\0"));
        assert!(!has_meshes(&rsb[..20]));
        let mut no_mesh = Scene {
            geometry: rt_core::scene::Geometry::default(),
            ..scene
        };
        no_mesh.lights.clear();
        assert!(!has_meshes(&no_mesh.to_rsb()));
    }

    #[test]
    fn a_scene_without_meshes_renders_when_it_is_marked_whole() {
        let mut scene = small_example(3, 24, 16);
        scene.geometry = rt_core::scene::Geometry::default();
        let rsb = scene.to_rsb();
        assert!(!has_meshes(&rsb));
        let engine = Engine::new(2);
        // Not marked: an update of a scene nobody loaded, for both kinds.
        for kind in [Kind::Viewport, Kind::Final] {
            assert_eq!(
                engine.submit(kind, &rsb, "e", "w", None).err(),
                Some(SubmitError::NeedMeshes)
            );
        }
        for kind in [Kind::Viewport, Kind::Final] {
            let job = engine
                .submit_scene(kind, &rsb, true, "e", "w", None)
                .unwrap();
            let f = wait_done(&job);
            assert_eq!((f.samples, f.sums.len()), (3, 24 * 16 * 4));
            assert_eq!(f.flags & FLAG_DONE, FLAG_DONE);
        }
        // The viewport now holds the empty scene: an update for the same key is applied.
        let job = engine.submit(Kind::Viewport, &rsb, "e", "w", None).unwrap();
        assert_eq!(wait_done(&job).samples, 3);
    }

    #[test]
    fn a_final_job_renders_every_sample_and_publishes_passes() {
        let engine = Engine::new(3);
        let scene = small_example(5, 40, 30);
        let job = engine
            .submit(Kind::Final, &scene.to_rsb(), "", "", None)
            .unwrap();
        let first = job.wait_newer(0, Duration::from_secs(60));
        assert!(first.pass >= 1);
        let f = wait_done(&job);
        // Passes of 1, 2, then the 2 left: 3 passes, 5 samples.
        assert_eq!((f.pass, f.samples), (3, 5));
        assert_eq!(f.flags & FLAG_DONE, FLAG_DONE);
        assert_eq!(f.sums.len(), 40 * 30 * 4);
        // Coverage sums are the sample count where everything is opaque.
        assert!(f.sums.chunks_exact(4).all(|px| px[3] == 5.0));
        let header = f.header(true);
        assert_eq!(&header[..4], b"RPX1");
        assert_eq!(u32::from_le_bytes(header[12..16].try_into().unwrap()), 5);
        assert_eq!(
            u32::from_le_bytes(header[28..32].try_into().unwrap()),
            FLAG_DONE | FLAG_DATA
        );
        let mut out = Vec::new();
        f.write(true, &mut out).unwrap();
        assert_eq!(out.len() as u64, f.len(true));
    }

    #[test]
    fn a_final_that_denoises_ends_with_the_denoised_image_of_rt_for_any_thread_count() {
        // E5b-1: the launcher's denoised image is `rt`'s (rt_cli::denoise_film over the same
        // film and guides), bit for bit, with 1 or 4 threads; the noisy one comes with it when
        // asked, and the kept image (the AI's input) is the denoised one.
        let _serial = serial();
        let mut scene = small_example(6, 64, 400);
        scene.render.denoise = DENOISE_IMAGE | DENOISE_KEEP_NOISY;
        scene.render.passes = rt_core::passes::PASS_DEPTH;
        let reference = rt_cli::render(&scene, 6, 2);
        let clean = reference.denoised(3).expect("guides");
        let expect = rt_post::denoise::rgba_sums(&clean);
        let noisy = rt_post::denoise::rgba_sums(&reference.film);
        assert_ne!(expect, noisy);
        for threads in [1usize, 4] {
            let engine = Engine::new(threads);
            let job = engine
                .submit(Kind::Final, &scene.to_rsb(), "", "", None)
                .unwrap();
            let f = wait_done(&job);
            assert_eq!(f.samples, 6);
            assert_eq!(
                f.flags & (FLAG_DENOISED | FLAG_NOISY),
                FLAG_DENOISED | FLAG_NOISY
            );
            assert_eq!(*f.sums, expect, "{threads} threads");
            assert_eq!(f.noisy.as_deref(), Some(&noisy), "{threads} threads");
            // The frame carries both, and reads back.
            let mut bytes = Vec::new();
            f.write(true, &mut bytes).unwrap();
            assert_eq!(bytes.len() as u64, f.len(true));
            assert_eq!(bytes.len(), FRAME_HEADER + 64 * 400 * 4 * 4 * 2);
            let back = Frame::read(&bytes).expect("frame");
            assert_eq!(
                (*back.sums == expect, back.noisy.as_deref() == Some(&noisy)),
                (true, true)
            );
            // The kept render is the denoised image, with the depth it asked for (not the guides).
            let kept = engine.kept(job.id).expect("kept");
            assert_eq!(*kept.image.sums, expect);
            assert_eq!(kept.passes.mask, rt_core::passes::PASS_DEPTH);
        }
        // Without bit 1 only the denoised image comes.
        scene.render.denoise = DENOISE_IMAGE;
        let engine = Engine::new(2);
        let job = engine
            .submit(Kind::Final, &scene.to_rsb(), "", "", None)
            .unwrap();
        let f = wait_done(&job);
        assert_eq!(f.flags & (FLAG_DENOISED | FLAG_NOISY), FLAG_DENOISED);
        assert!(f.noisy.is_none());
        assert_eq!(*f.sums, expect);
    }

    #[test]
    fn a_viewport_that_denoises_shows_denoised_frames() {
        let _serial = serial();
        let mut scene = small_example(4, 48, 36);
        scene.render.denoise = DENOISE_IMAGE;
        let engine = Engine::new(2);
        let job = engine
            .submit(Kind::Viewport, &scene.to_rsb(), "", "", None)
            .unwrap();
        let f = wait_done(&job);
        assert_eq!(f.samples, 4);
        assert_eq!(f.flags & FLAG_DENOISED, FLAG_DENOISED);
        // Its last frame is the denoised image of all its samples.
        let reference = rt_cli::render(&scene, 4, 2);
        let clean = reference.denoised(2).expect("guides");
        assert_eq!(*f.sums, rt_post::denoise::rgba_sums(&clean));
        // Without denoise, the plain sums and no flag.
        scene.render.denoise = 0;
        let job = engine
            .submit(Kind::Viewport, &scene.to_rsb(), "", "b", None)
            .unwrap();
        let f = wait_done(&job);
        assert_eq!(f.flags & (FLAG_DENOISED | FLAG_CAUSTICS), 0);
        assert_eq!(*f.sums, rt_post::denoise::rgba_sums(&reference.film));
    }

    #[test]
    fn caustics_give_the_pinned_image_with_any_thread_count() {
        // E5b-1: the photon maps traced in parallel by photon ranges are the same bits for any
        // thread count, so the image is rt-core's pinned one (PINNED_E5B_CAUSTICS_4SPP).
        let _serial = serial();
        let mut scene = rt_core::example::e5b_scene();
        scene.render.max_samples = 4;
        for threads in [1usize, 4, 16] {
            let engine = Engine::new(threads);
            let job = engine
                .submit(Kind::Final, &scene.to_rsb(), "", "", None)
                .unwrap();
            let f = wait_done(&job);
            assert_eq!(f.samples, 4);
            assert_eq!(f.flags & FLAG_CAUSTICS, FLAG_CAUSTICS);
            let inv = 1.0f32 / 4.0;
            let rgb: Vec<f32> = f
                .sums
                .chunks_exact(4)
                .flat_map(|p| [p[0] * inv, p[1] * inv, p[2] * inv])
                .collect();
            let hash = rgb
                .iter()
                .flat_map(|v| v.to_le_bytes())
                .fold(0x811c_9dc5u32, |h, b| {
                    (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
                });
            assert_eq!(hash, 0x5419_866e, "{threads} threads");
        }
    }

    #[test]
    fn a_final_job_with_passes_keeps_them_with_its_image_before_it_ends() {
        use rt_core::passes::{PASS_DEPTH, PASS_PART_ID};
        let _serial = serial();
        let engine = Engine::new(3);
        let mut scene = small_example(5, 40, 30);
        // Asked in the RSB and by the caller: the job renders both.
        scene.render.passes = PASS_DEPTH;
        // The look is kept with the render (the AI sees the image through it, X3c).
        scene.render.tonemap = 3;
        scene.render.exposure_ev = -0.75;
        let job = engine
            .submit_with(
                Kind::Final,
                &scene.to_rsb(),
                true,
                "",
                "",
                Options {
                    passes: PASS_ALL & !PASS_DEPTH,
                    ..Options::default()
                },
            )
            .unwrap();
        assert_eq!(job.passes, PASS_ALL);
        let f = wait_done(&job);
        assert_eq!(f.flags & FLAG_DONE, FLAG_DONE);
        let kept = engine.kept(job.id).expect("kept as it ended");
        assert_eq!(kept.image.sums, f.sums, "the image of the last frame");
        assert_eq!((kept.image.samples, kept.image.flags), (5, FLAG_DONE));
        assert_eq!(
            kept.look,
            Look {
                tonemap: 3,
                exposure_ev: -0.75
            }
        );
        // The passes rt-core renders on its own, for the same tiles and samples.
        let prepared = Prepared::new(&scene);
        let mut reference = Passes::new(40, 30, PASS_ALL);
        for tile in tile_grid(40, 30, TILE_SIZE) {
            let mut pf = PassFilm::region(tile.x, tile.y, tile.w, tile.h, PASS_ALL);
            render_tile_exact(&scene, &prepared, tile, &mut pf, engine.isa());
            for s in 0..5 {
                render_tile_albedo(&scene, &prepared, tile, s, &mut pf, engine.isa());
            }
            reference.copy_region(tile.x, tile.y, &pf.resolve());
        }
        assert_eq!(*kept.passes, reference);
        // And the image is the image of a job without passes, bit for bit.
        let plain = engine
            .submit(
                Kind::Final,
                &small_example(5, 40, 30).to_rsb(),
                "",
                "",
                None,
            )
            .unwrap();
        assert_eq!(wait_done(&plain).sums, f.sums);
        assert!(
            engine.kept(plain.id).is_none(),
            "nothing asked, nothing kept"
        );
        // Forgetting the job keeps the passes.
        engine.cancel(job.id);
        assert!(engine.job(job.id).is_none());
        assert!(engine.kept(job.id).is_some());

        // A viewport job ignores the passes of its RSB; a cancelled final keeps none.
        scene.render.passes = PASS_ALL;
        let view = engine
            .submit(Kind::Viewport, &scene.to_rsb(), "k", "w", None)
            .unwrap();
        assert_eq!(view.passes, 0);
        wait_done(&view);
        assert!(engine.kept(view.id).is_none());
        scene.render.max_samples = 100_000;
        let long = engine
            .submit_with(
                Kind::Final,
                &scene.to_rsb(),
                true,
                "",
                "",
                Options {
                    passes: PASS_PART_ID,
                    ..Options::default()
                },
            )
            .unwrap();
        long.wait_newer(0, Duration::from_secs(60));
        engine.cancel(long.id);
        assert_ne!(wait_done(&long).flags & FLAG_CANCELLED, 0);
        assert!(engine.kept(long.id).is_none());
        assert_eq!(engine.kept_ids(), [job.id]);
        engine.shutdown();
    }

    #[test]
    fn viewport_jobs_replace_each_other_and_keep_their_meshes() {
        let engine = Engine::new(2);
        let scene = small_example(4096, 64, 48);
        let full = scene.to_rsb();
        let a = engine
            .submit(Kind::Viewport, &full, "m1", "w", None)
            .unwrap();
        a.wait_newer(0, Duration::from_secs(60));
        // An update without meshes for the same key: camera moved.
        let mut moved = scene.clone();
        moved.camera.position.x += 10.0;
        moved.render.max_samples = 2;
        let mut update = moved.to_rsb();
        update = strip_meshes(&update);
        assert!(!has_meshes(&update));
        let b = engine
            .submit(Kind::Viewport, &update, "m1", "w", None)
            .unwrap();
        assert!(a.frame().flags & FLAG_CANCELLED != 0, "replaced");
        assert!(engine.job(a.id).is_none());
        let fb = wait_done(&b);
        assert_eq!(fb.samples, 2);
        // The same pixels as a full render of the moved scene.
        let c = engine
            .submit(Kind::Viewport, &moved.to_rsb(), "m1", "w", None)
            .unwrap();
        let fc = wait_done(&c);
        assert_eq!(fb.sums, fc.sums);
        // Another mesh key, or another window that has nothing loaded: send the meshes.
        assert_eq!(
            engine
                .submit(Kind::Viewport, &update, "m2", "w", None)
                .unwrap_err(),
            SubmitError::NeedMeshes
        );
        assert_eq!(
            engine
                .submit(Kind::Viewport, &update, "m1", "other", None)
                .unwrap_err(),
            SubmitError::NeedMeshes
        );
        // The refused update did not lose the loaded meshes.
        assert!(engine
            .submit(Kind::Viewport, &update, "m1", "w", None)
            .is_ok());
        // A broken update is refused and keeps the meshes too.
        assert!(matches!(
            engine.submit(Kind::Viewport, b"nope", "m1", "w", None),
            Err(SubmitError::BadScene(_))
        ));
        assert!(engine
            .submit(Kind::Viewport, &update, "m1", "w", None)
            .is_ok());
        assert!(matches!(
            engine.submit(Kind::Final, b"RSB1\0\0\0\0MESH\x01\0\0\0x", "", "", None),
            Err(SubmitError::BadScene(_))
        ));
        engine.shutdown();
    }

    #[test]
    fn a_final_job_pauses_the_viewport_and_cancel_stops_jobs() {
        let _serial = serial();
        let engine = Engine::new(2);
        let view = engine
            .submit(
                Kind::Viewport,
                &small_example(100_000, 96, 64).to_rsb(),
                "k",
                "w",
                None,
            )
            .unwrap();
        view.wait_newer(0, Duration::from_secs(60));
        let render = engine
            .submit(
                Kind::Final,
                &small_example(64, 96, 64).to_rsb(),
                "",
                "",
                None,
            )
            .unwrap();
        // While the final job runs, the viewport stops taking tiles.
        let deadline = Instant::now() + Duration::from_secs(60);
        while view.frame().flags & FLAG_PAUSED == 0 {
            assert!(Instant::now() < deadline, "the viewport never paused");
            std::thread::sleep(Duration::from_millis(5));
        }
        let paused_at = view.frame().pass;
        std::thread::sleep(Duration::from_millis(100));
        assert!(view.frame().pass <= paused_at + 1);
        let done = wait_done(&render);
        assert_eq!(done.samples, 64);
        // Then the viewport goes on.
        let resumed = view.wait_newer(view.frame().pass, Duration::from_secs(60));
        assert_eq!(resumed.flags & FLAG_PAUSED, 0);
        // Cancelling: the job ends as cancelled and is forgotten.
        assert!(engine.cancel(view.id));
        assert!(!engine.cancel(view.id));
        let f = wait_done(&view);
        assert_ne!(f.flags & FLAG_CANCELLED, 0);
        // A final cancelled while queued never runs.
        let long = engine
            .submit(
                Kind::Final,
                &small_example(100_000, 96, 64).to_rsb(),
                "",
                "",
                None,
            )
            .unwrap();
        long.wait_newer(0, Duration::from_secs(60)); // it has the gate
        let queued = engine
            .submit(
                Kind::Final,
                &small_example(4, 96, 64).to_rsb(),
                "",
                "",
                None,
            )
            .unwrap();
        engine.cancel(queued.id);
        let q = wait_done(&queued);
        assert_eq!((q.pass, q.flags & FLAG_CANCELLED), (0, FLAG_CANCELLED));
        engine.cancel(long.id);
        wait_done(&long);
        engine.shutdown();
    }

    #[test]
    fn the_time_budget_stops_between_passes() {
        let _serial = serial();
        let engine = Engine::new(2);
        let mut scene = small_example(1_000_000, 64, 48);
        scene.render.max_seconds = 0.3;
        let job = engine
            .submit(Kind::Final, &scene.to_rsb(), "", "", None)
            .unwrap();
        let f = wait_done(&job);
        assert_eq!(f.flags & FLAG_DONE, FLAG_DONE);
        assert!(f.samples > 0 && f.samples < 1_000_000);
        assert!(f.sums.chunks_exact(4).all(|px| px[3] == f.samples as f32));
    }

    #[test]
    fn finish_by_samples_time_or_first() {
        let _serial = serial();
        // The pass schedule and the stop rule are the page's (`tiles.ts`, `schedule.ts`).
        assert_eq!(next_pass(0, 0, 5), Some(1));
        assert_eq!(next_pass(1, 1, 5), Some(2));
        assert_eq!(next_pass(3, 2, 5), Some(2));
        assert_eq!(next_pass(5, 2, 5), None);
        assert_eq!(next_pass(31, 16, 0), Some(16), "no sample limit");
        assert_eq!(limits(Finish::Time, 64, 2.0), (0, Some(2000.0)));
        assert_eq!(limits(Finish::Samples, 64, 2.0), (64, None));
        assert_eq!(
            limits(Finish::First, 0, 1.5),
            (DEFAULT_SAMPLES, Some(1500.0))
        );
        assert_eq!(Finish::default_for(0.0), Finish::Samples);
        assert_eq!(Finish::default_for(3.0), Finish::First);
        assert!(
            !stop_for_time(0, 5000.0, Some(1000.0), Some(1.0), 1),
            "the first pass always runs"
        );
        assert!(
            stop_for_time(3, 1000.0, Some(1000.0), None, 4),
            "at the limit"
        );
        assert!(
            !stop_for_time(3, 900.0, Some(1000.0), Some(40.0), 4),
            "half the pass fits"
        );
        assert!(
            stop_for_time(3, 900.0, Some(1000.0), Some(60.0), 4),
            "less than half fits"
        );
        assert!(!stop_for_time(3, 1e9, None, Some(1.0), 4), "no time limit");

        let engine = Engine::new(2);
        // By samples: the time limit does not count.
        let mut scene = small_example(6, 32, 24);
        scene.render.max_seconds = 0.000_001;
        let f = wait_done(
            &engine
                .submit(Kind::Final, &scene.to_rsb(), "", "", Some(Finish::Samples))
                .unwrap(),
        );
        assert_eq!(f.samples, 6);
        // By time: the sample count does not count (a few samples would be over at once).
        scene.render.max_seconds = 0.4;
        let job = engine
            .submit(Kind::Final, &scene.to_rsb(), "", "", Some(Finish::Time))
            .unwrap();
        assert_eq!(job.max_samples, 0);
        let f = wait_done(&job);
        assert!(f.samples > 6, "{} samples in 0.4 s", f.samples);
        assert!(f.seconds >= 0.2 && f.seconds < 5.0, "{} s", f.seconds);
        // Whichever first: here the samples.
        let f = wait_done(
            &engine
                .submit(Kind::Final, &scene.to_rsb(), "", "", Some(Finish::First))
                .unwrap(),
        );
        assert_eq!(f.samples, 6);
    }

    #[test]
    fn a_queued_final_does_not_spend_its_time_waiting() {
        let _serial = serial();
        let engine = Engine::new(2);
        let long = engine
            .submit(
                Kind::Final,
                &small_example(100_000, 64, 48).to_rsb(),
                "",
                "",
                None,
            )
            .unwrap();
        long.wait_newer(0, Duration::from_secs(60)); // it has the gate
        let mut scene = small_example(1_000_000, 32, 24);
        scene.render.max_seconds = 0.3;
        let timed = engine
            .submit(Kind::Final, &scene.to_rsb(), "", "", Some(Finish::Time))
            .unwrap();
        // It waits for the gate ten times its own budget. What is asserted is the job's own clock, not how
        // fast this machine renders: it has not started while the job waits...
        let wait = Duration::from_secs(3);
        std::thread::sleep(wait);
        let waiting = timed.frame();
        assert_eq!(waiting.pass, 0, "still waiting for the first final");
        assert_eq!(waiting.seconds, 0.0, "its clock has not started");
        engine.cancel(long.id);
        let f = wait_done(&timed);
        // ...and at the end it counts only the rendering, which the time limit keeps far below the wait
        // (with the wait on its clock it would read at least 3 s, and stop after its first pass).
        assert_eq!(f.flags & FLAG_DONE, FLAG_DONE);
        assert!(f.pass >= 1);
        assert!(
            f.seconds < wait.as_secs_f32(),
            "{} s: the wait for the gate counted as rendering",
            f.seconds
        );
    }

    /// Waits until `cond` holds (or fails the test after `secs`).
    fn until(secs: u64, what: &str, mut cond: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(secs);
        while !cond() {
            assert!(Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn shared(share: usize) -> Options {
        Options {
            share,
            ..Options::default()
        }
    }

    #[test]
    fn a_live_viewport_keeps_its_share_while_a_final_takes_the_rest() {
        let _serial = serial();
        assert_eq!(
            (viewport_share(1), viewport_share(4), viewport_share(16)),
            (1, 1, 4)
        );
        let engine = Engine::new(4);
        let rsb = small_example(100_000, 96, 64).to_rsb();
        let view = engine
            .submit_with(Kind::Viewport, &rsb, true, "k", "w", shared(1))
            .unwrap();
        view.wait_newer(0, Duration::from_secs(60));
        assert_eq!(
            view.frame().threads,
            4,
            "alone, the viewport has every thread"
        );
        let render = engine
            .submit(
                Kind::Final,
                &small_example(256, 128, 96).to_rsb(),
                "",
                "",
                None,
            )
            .unwrap();
        // While the final runs, the viewport renders on its share and says so; the final has the rest.
        until(60, "the viewport never shared", || {
            view.frame().flags & FLAG_SHARED != 0
        });
        until(60, "the final never left the share", || {
            let f = render.frame();
            f.flags & FLAG_SHARED != 0 && f.threads == 3
        });
        let v = view.frame();
        assert_eq!((v.threads, v.flags & FLAG_PAUSED), (1, 0));
        // It stays live: new passes reach the page while the final is still rendering.
        let before = view.frame().pass;
        until(120, "the viewport stopped while the final ran", || {
            view.frame().pass > before
        });
        assert!(!render.frame().finished(), "the final was still running");
        assert_eq!(lock(&engine.inner.gate.state).live, 1);
        assert_eq!(wait_done(&render).samples, 256);
        // The final is over: the viewport has every thread again.
        until(60, "the viewport did not get its threads back", || {
            let f = view.frame();
            f.flags & FLAG_SHARED == 0 && f.threads == 4
        });
        // A viewport job that ends gives its share back.
        engine.cancel(view.id);
        wait_done(&view);
        until(10, "the share was not given back", || {
            lock(&engine.inner.gate.state).live == 0
        });
        engine.shutdown();
    }

    #[test]
    fn the_final_image_is_the_same_bits_with_or_without_a_live_viewport() {
        let _serial = serial();
        let scene = small_example(12, 80, 56).to_rsb();
        let alone = {
            let engine = Engine::new(4);
            let f = wait_done(&engine.submit(Kind::Final, &scene, "", "", None).unwrap());
            engine.shutdown();
            f
        };
        let engine = Engine::new(4);
        // A live viewport of another view of the same product, sharing two threads.
        let mut other = small_example(100_000, 96, 64);
        other.camera.position.x += 5.0;
        let view = engine
            .submit_with(Kind::Viewport, &other.to_rsb(), true, "k", "w", shared(2))
            .unwrap();
        view.wait_newer(0, Duration::from_secs(60));
        let render = engine.submit(Kind::Final, &scene, "", "", None).unwrap();
        let with = wait_done(&render);
        assert!(view.frame().pass >= 1 && !view.frame().finished());
        assert_eq!(with.samples, alone.samples);
        assert!(
            with.sums
                .iter()
                .zip(alone.sums.iter())
                .all(|(a, b)| a.to_bits() == b.to_bits()),
            "the final image changed with a live viewport"
        );
        // And with one thread, as `rt` would.
        let one = Engine::new(1);
        let f = wait_done(&one.submit(Kind::Final, &scene, "", "", None).unwrap());
        assert!(f
            .sums
            .iter()
            .zip(alone.sums.iter())
            .all(|(a, b)| a.to_bits() == b.to_bits()));
        engine.shutdown();
        one.shutdown();
    }

    #[test]
    fn passes_are_the_same_with_a_live_viewport_and_an_orphaned_final_keeps_none() {
        let _serial = serial();
        // Long enough for the final to be seen sharing.
        let mut scene = small_example(48, 96, 64);
        scene.render.passes = PASS_ALL;
        let rsb = scene.to_rsb();
        let alone = {
            let engine = Engine::new(4);
            let job = engine.submit(Kind::Final, &rsb, "", "", None).unwrap();
            wait_done(&job);
            let kept = engine.kept(job.id).expect("kept alone");
            engine.shutdown();
            kept
        };
        // The same final while a live viewport of another view keeps two of the four threads: which
        // threads render a tile changes neither a pixel nor a pass.
        let engine = Engine::new(4);
        let mut other = small_example(100_000, 96, 64);
        other.camera.position.x += 5.0;
        other.render.passes = PASS_ALL;
        let view = engine
            .submit_with(Kind::Viewport, &other.to_rsb(), true, "k", "w", shared(2))
            .unwrap();
        assert_eq!(view.passes, 0, "a viewport renders no passes");
        view.wait_newer(0, Duration::from_secs(60));
        let render = engine.submit(Kind::Final, &rsb, "", "", None).unwrap();
        let mut saw_shared = false;
        while !render.frame().finished() {
            saw_shared |= render.frame().flags & FLAG_SHARED != 0;
            std::thread::sleep(Duration::from_millis(1));
        }
        let with = engine.kept(render.id).expect("kept while sharing");
        assert!(saw_shared, "the final never left the viewport its share");
        assert!(!view.frame().finished(), "the viewport stayed live");
        assert_eq!(*with.passes, *alone.passes);
        assert!(with
            .image
            .sums
            .iter()
            .zip(alone.image.sums.iter())
            .all(|(a, b)| a.to_bits() == b.to_bits()));
        assert!(engine.kept(view.id).is_none());
        engine.shutdown();
        // A final whose page went away (nobody asks about it) stops, and keeps nothing.
        let lonely = Engine::with_limits(
            2,
            Limits {
                orphan_final: Duration::from_millis(300),
                ..Limits::default()
            },
        );
        scene.render.max_samples = 100_000;
        let job = lonely
            .submit(Kind::Final, &scene.to_rsb(), "", "", None)
            .unwrap();
        assert_ne!(wait_done(&job).flags & FLAG_CANCELLED, 0);
        assert!(lonely.kept(job.id).is_none());
        assert!(lonely.kept_ids().is_empty());
        lonely.shutdown();
    }

    #[test]
    fn a_late_view_does_not_replace_a_newer_one() {
        let engine = Engine::new(2);
        let rsb = small_example(100_000, 32, 24).to_rsb();
        let seq = |n: u64| Options {
            seq: Some(n),
            ..Options::default()
        };
        let newer = engine
            .submit_with(Kind::Viewport, &rsb, true, "k", "w", seq(2))
            .unwrap();
        // The request of view 1 overtaken on the way: refused, and view 2 goes on.
        assert_eq!(
            engine
                .submit_with(Kind::Viewport, &rsb, true, "k", "w", seq(1))
                .unwrap_err(),
            SubmitError::Stale
        );
        assert_eq!(
            engine
                .submit_with(Kind::Viewport, &rsb, true, "k", "w", seq(2))
                .unwrap_err(),
            SubmitError::Stale
        );
        assert!(engine.job(newer.id).is_some());
        assert_eq!(newer.frame().flags & FLAG_CANCELLED, 0);
        // An update the launcher cannot apply (409 need-meshes) is sent again whole with the same
        // number: that one is not stale.
        let update = strip_meshes(&rsb);
        assert_eq!(
            engine
                .submit_with(Kind::Viewport, &update, false, "other-meshes", "w", seq(7))
                .unwrap_err(),
            SubmitError::NeedMeshes
        );
        let whole = engine
            .submit_with(Kind::Viewport, &rsb, true, "other-meshes", "w", seq(7))
            .unwrap();
        assert_ne!(wait_done(&newer).flags & FLAG_CANCELLED, 0);
        let newer = whole;
        // Another window counts on its own; a newer view replaces it as before.
        assert!(engine
            .submit_with(Kind::Viewport, &rsb, true, "k", "other", seq(1))
            .is_ok());
        let third = engine
            .submit_with(Kind::Viewport, &rsb, true, "k", "w", seq(8))
            .unwrap();
        assert_ne!(wait_done(&newer).flags & FLAG_CANCELLED, 0);
        assert_eq!(third.frame().flags & FLAG_CANCELLED, 0);
        engine.shutdown();
    }

    #[test]
    fn a_job_nobody_asks_about_stops() {
        let _serial = serial();
        let limit = Duration::from_millis(1000);
        let engine = Engine::with_limits(
            2,
            Limits {
                orphan_viewport: limit,
                orphan_final: limit,
                ..Limits::default()
            },
        );
        let rsb = small_example(100_000, 64, 48).to_rsb();
        let view = engine
            .submit_with(Kind::Viewport, &rsb, true, "k", "w", Options::default())
            .unwrap();
        // Polled: it goes on.
        let t = Instant::now();
        while t.elapsed() < Duration::from_millis(2500) {
            view.touch();
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!view.frame().finished(), "a polled job stopped");
        // Its page went away: it stops by itself.
        assert_ne!(wait_done(&view).flags & FLAG_CANCELLED, 0);
        // A final too, even one still waiting for the gate behind another.
        let long = engine.submit(Kind::Final, &rsb, "", "", None).unwrap();
        // It has the gate (the threads of two finals may start in any order).
        long.wait_newer(0, Duration::from_secs(60));
        let queued = engine.submit(Kind::Final, &rsb, "", "", None).unwrap();
        let t = Instant::now();
        while !queued.frame().finished() {
            long.touch();
            assert!(
                t.elapsed() < Duration::from_secs(30),
                "the queued final never stopped"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        let q = queued.frame();
        assert_eq!((q.pass, q.flags & FLAG_CANCELLED), (0, FLAG_CANCELLED));
        let l = long.frame();
        assert!(
            !l.finished(),
            "the polled final stopped: {:?} {:?}",
            l.flags,
            long.error()
        );
        assert_ne!(wait_done(&long).flags & FLAG_CANCELLED, 0);
        engine.shutdown();
    }

    #[test]
    fn a_render_that_panics_ends_failed_and_frees_the_gate() {
        let scene = small_example(4, 8, 8);
        let job = Job::new(1, Kind::Final, &scene, 2, &Options::default(), ORPHAN_FINAL);
        guarded(&job, || panic!("boom"));
        let f = job.frame();
        assert_eq!(f.flags & FLAG_FAILED, FLAG_FAILED);
        assert_eq!(job.error().as_deref(), Some("boom"));
        // A final that panics with the gate held gives it up.
        let gate = Gate::default();
        let held = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _turn = gate.enter_final(&job).unwrap();
            panic!("inside the turn");
        }));
        assert!(held.is_err());
        assert_eq!(lock(&gate.state).running, 0);
        let next = Job::new(2, Kind::Final, &scene, 2, &Options::default(), ORPHAN_FINAL);
        assert!(
            gate.enter_final(&next).is_some(),
            "the next final waits for ever"
        );
        // And a live viewport's share comes back after a panic too.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _share = gate.live(3);
            panic!("inside the share");
        }));
        assert_eq!(lock(&gate.state).live, 0);
    }

    #[test]
    fn a_viewport_job_that_does_not_stop_is_left_behind() {
        let _serial = serial();
        let scene = small_example(4, 8, 8);
        let mut slot = Viewport::default();
        let job = Arc::new(Job::new(
            1,
            Kind::Viewport,
            &scene,
            2,
            &Options::default(),
            ORPHAN_VIEWPORT,
        ));
        // A render thread stuck in a tile (it ignores the cancel for two seconds).
        let stuck = scene.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(2));
            stuck
        });
        slot.running = Some((Arc::clone(&job), handle));
        let t = Instant::now();
        slot.stop(Duration::from_millis(100));
        assert!(
            t.elapsed() < Duration::from_secs(1),
            "it waited for the stuck job"
        );
        assert!(job.cancelled());
        assert!(
            slot.scene.is_none(),
            "no scene: the next update asks for the whole one"
        );
        // One that stops in time gives its scene back.
        let back = scene.clone();
        slot.running = Some((Arc::clone(&job), std::thread::spawn(move || back)));
        slot.stop(Duration::from_secs(5));
        assert!(slot.scene.is_some());
    }

    #[test]
    fn a_cancelled_or_ended_final_reopens_the_gate_with_any_number_of_threads() {
        let _serial = serial();
        // The user's machine has 16 threads; more threads than cores must work too.
        for threads in [4usize, 16, 32] {
            let engine = Engine::new(threads);
            for share in [0usize, viewport_share(threads)] {
                let view = engine
                    .submit_with(
                        Kind::Viewport,
                        &small_example(100_000, 96, 64).to_rsb(),
                        true,
                        "k",
                        "w",
                        shared(share),
                    )
                    .unwrap();
                view.wait_newer(0, Duration::from_secs(60));
                // A final cancelled while it renders (the queue's Pause: DELETE).
                let running = engine
                    .submit(
                        Kind::Final,
                        &small_example(100_000, 96, 64).to_rsb(),
                        "",
                        "",
                        None,
                    )
                    .unwrap();
                running.wait_newer(0, Duration::from_secs(60));
                // One cancelled while it waits for the gate.
                let waiting = engine
                    .submit(
                        Kind::Final,
                        &small_example(8, 32, 24).to_rsb(),
                        "",
                        "",
                        None,
                    )
                    .unwrap();
                until(60, "the viewport did not notice the final", || {
                    view.frame().flags & (FLAG_PAUSED | FLAG_SHARED) != 0
                });
                assert!(engine.cancel(waiting.id) && engine.cancel(running.id));
                wait_done(&running);
                wait_done(&waiting);
                // The gate is open again: the viewport goes on, on every thread.
                let at = view.frame().pass;
                until(60, "the viewport stayed behind the gate", || {
                    let f = view.frame();
                    view.touch();
                    f.pass > at && f.flags & (FLAG_PAUSED | FLAG_SHARED) == 0
                });
                assert_eq!(view.frame().threads as usize, threads);
                {
                    let s = lock(&engine.inner.gate.state);
                    assert_eq!((s.running, s.queue.len()), (0, 0), "{threads} threads");
                }
                // A final that ends by itself, too.
                let short = engine
                    .submit(
                        Kind::Final,
                        &small_example(2, 32, 24).to_rsb(),
                        "",
                        "",
                        None,
                    )
                    .unwrap();
                wait_done(&short);
                let at = view.frame().pass;
                until(
                    60,
                    "the viewport stayed behind the gate after a final ended",
                    || {
                        view.touch();
                        view.frame().pass > at
                    },
                );
                engine.cancel(view.id);
                wait_done(&view);
            }
            // The diagnostics tell the gate, the jobs and the windows.
            let state = crate::json::parse(&engine.state_json()).unwrap();
            assert_eq!(state.get("threads").unwrap().as_f64(), Some(threads as f64));
            let gate = state.get("gate").unwrap();
            assert_eq!(gate.get("finalsRunning").unwrap().as_f64(), Some(0.0));
            assert_eq!(gate.get("liveViewportThreads").unwrap().as_f64(), Some(0.0));
            assert_eq!(state.get("viewports").unwrap().as_array().unwrap().len(), 1);
            engine.shutdown();
        }
    }

    #[test]
    fn windows_that_went_away_never_keep_a_new_one_out() {
        let _serial = serial();
        let limit = Duration::from_millis(400);
        // (A window is not "gone" before its job is: this is about jobs whose pages went away.)
        let engine = Engine::with_limits(
            2,
            Limits {
                orphan_viewport: limit,
                gone_client: Duration::from_secs(3600),
                ..Limits::default()
            },
        );
        let rsb = small_example(100_000, 32, 24).to_rsb();
        let old: Vec<_> = (0..MAX_CLIENTS)
            .map(|i| {
                engine
                    .submit_with(
                        Kind::Viewport,
                        &rsb,
                        true,
                        "k",
                        &format!("old{i}"),
                        Options::default(),
                    )
                    .unwrap()
            })
            .collect();
        // Every window renders: one more is refused for now...
        assert_eq!(
            engine
                .submit_with(Kind::Viewport, &rsb, true, "k", "new", Options::default())
                .unwrap_err(),
            SubmitError::Busy
        );
        // ...but their pages are gone, so their jobs stop and the new window gets in.
        for job in &old {
            wait_done(job);
        }
        assert!(engine
            .submit_with(Kind::Viewport, &rsb, true, "k", "new", Options::default())
            .is_ok());
        engine.shutdown();
    }

    #[test]
    fn a_page_reloaded_again_and_again_still_renders() {
        // Every reload is a new window (a new client id) and its old self never asks again, not
        // even to cancel (the worst case: the page could not send its DELETE). Jobs nobody asks
        // about stop only after a long time here, so it is the slots that must be given back.
        let gone = Duration::from_millis(50);
        let engine = Engine::with_limits(
            2,
            Limits {
                orphan_viewport: Duration::from_secs(3600),
                gone_client: gone,
                ..Limits::default()
            },
        );
        let rsb = small_example(100_000, 32, 24).to_rsb();
        let mut previous: Option<Arc<Job>> = None;
        for reload in 0..3 * MAX_CLIENTS {
            let page = format!("page{reload}");
            // The page that went away has not asked for a little longer than a page in use ever waits.
            if let Some(old) = &previous {
                until(30, "time stood still", || old.unasked() > gone);
            }
            let job = engine
                .submit_with(Kind::Viewport, &rsb, true, "k", &page, Options::default())
                .unwrap_or_else(|e| panic!("reload {reload}: {e:?}"));
            // It renders: its page asks about it as it polls.
            until(60, "the reloaded page does not render", || {
                job.touch();
                job.frame().pass >= 1
            });
            previous = Some(job);
        }
        // Never more windows than the cap, and the last page still renders.
        assert!(lock(&engine.inner.viewports).len() <= MAX_CLIENTS);
        let last = previous.unwrap();
        assert!(!last.frame().finished());
        engine.shutdown();
        // Windows in use are never pushed out: eight live pages, a ninth is refused for now.
        let engine = Engine::with_limits(
            2,
            Limits {
                gone_client: Duration::from_secs(2),
                ..Limits::default()
            },
        );
        let live: Vec<_> = (0..MAX_CLIENTS)
            .map(|i| {
                engine
                    .submit_with(
                        Kind::Viewport,
                        &rsb,
                        true,
                        "k",
                        &format!("live{i}"),
                        Options::default(),
                    )
                    .unwrap()
            })
            .collect();
        for job in &live {
            job.touch();
        }
        assert_eq!(
            engine
                .submit_with(Kind::Viewport, &rsb, true, "k", "ninth", Options::default())
                .unwrap_err(),
            SubmitError::Busy
        );
        engine.shutdown();
    }

    #[test]
    fn a_long_poll_hears_at_once_that_the_viewport_stopped_sharing() {
        let scene = small_example(4, 8, 8);
        let job = Arc::new(Job::new(
            1,
            Kind::Viewport,
            &scene,
            4,
            &shared(1),
            ORPHAN_VIEWPORT,
        ));
        job.set_mode(FLAG_SHARED, 1);
        // The final ends: the job's first thread says so at its next turn, with no new pass.
        let speaker = Arc::clone(&job);
        let turn = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            speaker.set_mode(0, 4);
        });
        let t = Instant::now();
        let f = job.wait_newer(0, Duration::from_secs(60));
        turn.join().unwrap();
        assert_eq!((f.flags & FLAG_SHARED, f.threads, f.pass), (0, 4, 0));
        assert!(
            t.elapsed() < Duration::from_secs(30),
            "it waited for a pass that never came"
        );
    }

    /// Drops the MESH sections of an RSB file.
    pub(crate) fn strip_meshes(rsb: &[u8]) -> Vec<u8> {
        let mut out = rsb[..8].to_vec();
        let mut pos = 8;
        while pos + 8 <= rsb.len() {
            let len = u32::from_le_bytes(rsb[pos + 4..pos + 8].try_into().unwrap()) as usize;
            if &rsb[pos..pos + 4] != b"MESH" {
                out.extend_from_slice(&rsb[pos..pos + 8 + len]);
            }
            pos += 8 + len;
        }
        out
    }
}

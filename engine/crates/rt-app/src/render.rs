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
//! Jobs: a **final** job (Render) has priority: viewport jobs pause between tiles while one runs,
//! and finals run one at a time, in the order they came. A new **viewport** job of a client
//! replaces that client's previous one; an update without `MESH` sections keeps the previous
//! job's meshes and their BVHs (`Scene::update_from_rsb`), so moving the camera does not send or
//! rebuild the geometry.
//!
//! **Passes** (X2, `rt_core::passes`): a final job may ask for the exact passes (`RNDR.passes`
//! of its RSB, and `passes=` of `/api/render`). They are rendered next to the image, tile by
//! tile (the exact planes in the first pass, an albedo ray after every sample), never change a
//! pixel of it, and when the job ends with all its samples the image and the passes go to the
//! store of [`crate::kept`] before the job says it is done, so they are there for whoever reads
//! the end. Viewport jobs never render passes.

use crate::kept::{KeepLimits, Kept, KeptRender, PassesBody};
use rt_core::image::Film;
use rt_core::integrator::Prepared;
use rt_core::passes::{PassFilm, Passes, PASS_ALL};
use rt_core::render::{render_tile_albedo, render_tile_exact, render_tile_prepared, tile_grid};
use rt_core::scene::Scene;
use rt_core::simd::Isa;
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

/// What a job is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// The viewport (Full mode): replaced by the next one, paused by finals.
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
    /// Threads rendering.
    pub threads: u32,
    /// Rays cast so far.
    pub rays: u64,
    /// RGBA sums, `width * height * 4` (empty before the first pass).
    pub sums: Arc<Vec<f32>>,
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

    /// Writes the header and, with `data`, the sums as little-endian `f32`.
    pub fn write(&self, data: bool, w: &mut dyn Write) -> io::Result<()> {
        w.write_all(&self.header(data))?;
        if data {
            let mut buf = Vec::with_capacity(64 * 1024);
            for chunk in self.sums.chunks(16 * 1024) {
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
        FRAME_HEADER as u64 + if data { self.sums.len() as u64 * 4 } else { 0 }
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
        let sums = if flags & FLAG_DATA != 0 {
            let n = (width as usize)
                .checked_mul(height as usize)?
                .checked_mul(4)?;
            let data = bytes.get(header..header.checked_add(n.checked_mul(4)?)?)?;
            data.chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect()
        } else {
            Vec::new()
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
    paused: bool,
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
    /// The exact passes it renders next to the image (`rt_core::passes` bits; 0 for none, and
    /// always for a viewport job).
    pub passes: u32,
    /// The time limit in milliseconds, if any.
    limit_ms: Option<f64>,
    threads: usize,
    cancel: AtomicBool,
    progress: Mutex<Progress>,
    changed: Condvar,
}

impl std::fmt::Debug for Job {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Job")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("width", &self.width)
            .field("height", &self.height)
            .field("max_samples", &self.max_samples)
            .finish_non_exhaustive()
    }
}

impl Job {
    fn new(
        id: u32,
        kind: Kind,
        scene: &Scene,
        threads: usize,
        finish: Option<Finish>,
        passes: u32,
    ) -> Job {
        let r = &scene.render;
        let finish = finish.unwrap_or(Finish::default_for(r.max_seconds));
        let (max_samples, limit_ms) = limits(finish, r.max_samples, r.max_seconds);
        Job {
            id,
            kind,
            width: r.width,
            height: r.height,
            max_samples,
            passes: match kind {
                Kind::Final => passes & PASS_ALL,
                Kind::Viewport => 0,
            },
            limit_ms,
            threads,
            cancel: AtomicBool::new(false),
            progress: Mutex::new(Progress {
                started: None,
                pass: 0,
                samples: 0,
                rays: 0,
                sums: Arc::new(Vec::new()),
                paused: false,
                ended: None,
                error: None,
            }),
            changed: Condvar::new(),
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

    fn frame_of(&self, p: &Progress) -> Frame {
        let (mut flags, seconds) = match p.ended {
            Some((flags, s)) => (flags, s),
            None => (0, p.started.map_or(0.0, |t| t.elapsed().as_secs_f32())),
        };
        if p.paused && p.ended.is_none() {
            flags |= FLAG_PAUSED;
        }
        Frame {
            pass: p.pass,
            samples: p.samples,
            width: self.width,
            height: self.height,
            seconds,
            flags,
            max_samples: self.max_samples,
            threads: self.threads as u32,
            rays: p.rays,
            sums: Arc::clone(&p.sums),
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

    /// Waits up to `timeout` for a pass newer than `after` (or the end) and returns the frame.
    pub fn wait_newer(&self, after: u32, timeout: Duration) -> Frame {
        let deadline = Instant::now() + timeout;
        let mut p = lock(&self.progress);
        loop {
            if p.pass > after || p.ended.is_some() {
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

    fn set_paused(&self, paused: bool) {
        let mut p = lock(&self.progress);
        if p.paused != paused {
            p.paused = paused;
            drop(p);
            self.changed.notify_all();
        }
    }

    fn end(&self, flags: u32, error: Option<String>) {
        let mut p = lock(&self.progress);
        let seconds = p.started.map_or(0.0, |t| t.elapsed().as_secs_f32());
        p.ended = Some((flags, seconds));
        p.paused = false;
        p.error = error;
        drop(p);
        self.changed.notify_all();
    }
}

/// Final jobs run one at a time, in order; viewport jobs wait while one runs.
#[derive(Default)]
struct Gate {
    state: Mutex<GateState>,
    changed: Condvar,
}

#[derive(Default)]
struct GateState {
    queue: VecDeque<u32>,
    running: u32,
}

impl Gate {
    /// Waits for `job`'s turn; false if it was cancelled first.
    fn enter_final(&self, job: &Job) -> bool {
        let mut s = lock(&self.state);
        s.queue.push_back(job.id);
        loop {
            if job.cancelled() {
                s.queue.retain(|&id| id != job.id);
                drop(s);
                self.changed.notify_all();
                return false;
            }
            if s.running == 0 && s.queue.front() == Some(&job.id) {
                s.queue.pop_front();
                s.running += 1;
                return true;
            }
            s = self
                .changed
                .wait_timeout(s, Duration::from_millis(100))
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    fn exit_final(&self) {
        lock(&self.state).running -= 1;
        self.changed.notify_all();
    }

    /// Before a viewport tile: waits while a final runs; false when `job` was cancelled.
    fn viewport_turn(&self, job: &Job) -> bool {
        let mut s = lock(&self.state);
        let mut paused = false;
        while (s.running > 0 || !s.queue.is_empty()) && !job.cancelled() {
            if !paused {
                paused = true;
                job.set_paused(true);
            }
            s = self
                .changed
                .wait_timeout(s, Duration::from_millis(50))
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        drop(s);
        if paused {
            job.set_paused(false);
        }
        !job.cancelled()
    }
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
/// after the samples, or between passes near the time limit; never inside a pass. With
/// `job.passes`, the exact passes of every tile come with its first pass and the albedo of every
/// sample after it; they are returned, assembled, unless the job was cancelled. The caller ends
/// the job.
fn render(job: &Job, scene: &Scene, gate: &Gate, isa: Isa) -> Option<Passes> {
    let (width, height) = (job.width, job.height);
    let prepared = Prepared::new(scene);
    let tiles = tile_grid(width, height, TILE_SIZE);
    let threads = job.threads.clamp(1, tiles.len().max(1));
    let films: Vec<Mutex<Film>> = tiles
        .iter()
        .map(|t| Mutex::new(Film::region(t.x, t.y, t.w, t.h)))
        .collect();
    let pass_films: Vec<Mutex<PassFilm>> = if job.passes == 0 {
        Vec::new()
    } else {
        tiles
            .iter()
            .map(|t| Mutex::new(PassFilm::region(t.x, t.y, t.w, t.h, job.passes)))
            .collect()
    };
    let t0 = Instant::now();
    lock(&job.progress).started = Some(t0);
    let ms = |t: Instant| t.duration_since(t0).as_secs_f64() * 1000.0;
    let (mut done, mut previous, mut passes, mut rays) = (0u32, 0u32, 0u32, 0u64);
    let mut ms_per_sample: Option<f64> = None;
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
        let next_tile = AtomicUsize::new(0);
        let pass_rays: u64 = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|_| {
                    scope.spawn(|| {
                        let mut rays = 0u64;
                        loop {
                            let go = match job.kind {
                                Kind::Viewport => gate.viewport_turn(job),
                                Kind::Final => !job.cancelled(),
                            };
                            if !go {
                                break;
                            }
                            let i = next_tile.fetch_add(1, Ordering::Relaxed);
                            let (Some(&tile), Some(film)) = (tiles.get(i), films.get(i)) else {
                                break;
                            };
                            let mut film = lock(film);
                            let mut passes = pass_films.get(i).map(lock);
                            if let (Some(passes), 0) = (passes.as_deref_mut(), first) {
                                rays += render_tile_exact(scene, &prepared, tile, passes, isa);
                            }
                            for sample in first..first + count {
                                rays += render_tile_prepared(
                                    scene, &prepared, tile, sample, &mut film, isa,
                                );
                                if let Some(passes) = passes.as_deref_mut() {
                                    rays += render_tile_albedo(
                                        scene, &prepared, tile, sample, passes, isa,
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
        let sums = Arc::new(sums_of(&films, width, height));
        {
            let mut p = lock(&job.progress);
            p.pass = passes;
            p.samples = done;
            p.rays = rays;
            p.sums = sums;
        }
        job.changed.notify_all();
    }
    if job.cancelled() || pass_films.is_empty() {
        return None;
    }
    // Each tile's film is dropped once copied, so a large image does not hold its passes twice.
    let mut passes = Passes::new(width, height, job.passes);
    for film in pass_films {
        let f = film.into_inner().unwrap_or_else(PoisonError::into_inner);
        passes.copy_region(f.origin_x, f.origin_y, &f.resolve());
    }
    Some(passes)
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
}

impl Viewport {
    /// Stops the running job (if any) and takes its scene back.
    fn stop(&mut self) {
        if let Some((job, handle)) = self.running.take() {
            job.cancel();
            self.scene = handle.join().ok();
        }
    }

    fn idle(&self) -> bool {
        self.running
            .as_ref()
            .is_none_or(|(job, _)| job.frame().finished())
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
    kept: Kept,
}

/// The renderer: jobs, their threads and their priority.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

impl Engine {
    /// An engine rendering on `threads` threads (0: every hardware thread), keeping the passes
    /// of its final renders in memory only.
    pub fn new(threads: usize) -> Engine {
        Engine::with_store(threads, KeepLimits::default(), None)
    }

    /// An engine that keeps final renders with passes within `limits`, spilling large ones into
    /// `cache` (`<data>/cache/ai`; its files of a previous launch are removed now).
    pub fn with_store(threads: usize, limits: KeepLimits, cache: Option<PathBuf>) -> Engine {
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
                kept: Kept::new(limits, cache),
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
        self.submit_scene(kind, rsb, has_meshes(rsb), mesh_key, client, finish, 0)
    }

    /// Starts a job from RSB bytes. `whole` says the bytes are the complete scene, so it is read
    /// with `Scene::from_rsb` even when it has no `MESH` section (an empty project: a studio with
    /// no model); otherwise they are an update of the scene this client loaded before, which a
    /// final job never takes. `mesh_key` names the geometry (an update must name the meshes it
    /// expects); `client` tells viewport jobs of different windows apart; `finish` is when it
    /// stops (`None`: [`Finish::default_for`] its time limit). A final job renders the passes of
    /// `passes` and of its `RNDR.passes` (`rt_core::passes` bits); a viewport job none.
    #[allow(clippy::too_many_arguments)]
    pub fn submit_scene(
        &self,
        kind: Kind,
        rsb: &[u8],
        whole: bool,
        mesh_key: &str,
        client: &str,
        finish: Option<Finish>,
        passes: u32,
    ) -> Result<Arc<Job>, SubmitError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        match kind {
            Kind::Final => {
                if !whole {
                    return Err(SubmitError::NeedMeshes);
                }
                let scene =
                    Scene::from_rsb(rsb).map_err(|e| SubmitError::BadScene(e.to_string()))?;
                let mask = passes | scene.render.passes;
                let job = Arc::new(Job::new(id, kind, &scene, self.inner.threads, finish, mask));
                self.register(&job);
                let (engine, run) = (self.clone(), Arc::clone(&job));
                std::thread::spawn(move || {
                    let inner = &engine.inner;
                    if inner.gate.enter_final(&run) {
                        let passes = render(&run, &scene, &inner.gate, inner.isa);
                        inner.gate.exit_final();
                        // Kept before the job says it is done: whoever sees the end finds them.
                        if let (Some(passes), false) = (passes, run.cancelled()) {
                            let mut image = run.frame();
                            image.flags = FLAG_DONE;
                            inner.kept.keep(KeptRender {
                                id: run.id,
                                image,
                                passes: Arc::new(passes),
                            });
                        }
                        run.end(end_flags(&run), None);
                    } else {
                        run.end(FLAG_CANCELLED, None);
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
                    let idle: Vec<String> = viewports
                        .iter()
                        .filter(|(_, v)| v.idle())
                        .map(|(k, _)| k.clone())
                        .collect();
                    for k in idle {
                        viewports.remove(&k);
                    }
                    if viewports.len() >= MAX_CLIENTS {
                        return Err(SubmitError::Busy);
                    }
                }
                let slot = viewports.entry(client.to_string()).or_default();
                if let Some((old, _)) = &slot.running {
                    lock(&self.inner.jobs).remove(&old.id);
                }
                slot.stop();
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
                let job = Arc::new(Job::new(
                    id,
                    kind,
                    &scene,
                    self.inner.threads,
                    finish,
                    scene.render.passes,
                ));
                self.register(&job);
                let (engine, run) = (self.clone(), Arc::clone(&job));
                let handle = std::thread::spawn(move || {
                    render(&run, &scene, &engine.inner.gate, engine.inner.isa);
                    run.end(end_flags(&run), None);
                    scene
                });
                slot.running = Some((Arc::clone(&job), handle));
                Ok(job)
            }
        }
    }

    /// Stops every job (the application is closing).
    pub fn shutdown(&self) {
        for job in lock(&self.inner.jobs).values() {
            job.cancel();
        }
        for slot in lock(&self.inner.viewports).values_mut() {
            slot.stop();
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
                .submit_scene(kind, &rsb, true, "e", "w", None, 0)
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
    fn a_final_job_with_passes_keeps_them_with_its_image_before_it_ends() {
        use rt_core::passes::{PASS_DEPTH, PASS_PART_ID};
        let engine = Engine::new(3);
        let mut scene = small_example(5, 40, 30);
        // Asked in the RSB and by the caller: the job renders both.
        scene.render.passes = PASS_DEPTH;
        let job = engine
            .submit_scene(
                Kind::Final,
                &scene.to_rsb(),
                true,
                "",
                "",
                None,
                PASS_ALL & !PASS_DEPTH,
            )
            .unwrap();
        assert_eq!(job.passes, PASS_ALL);
        let f = wait_done(&job);
        assert_eq!(f.flags & FLAG_DONE, FLAG_DONE);
        let kept = engine.kept(job.id).expect("kept as it ended");
        assert_eq!(kept.image.sums, f.sums, "the image of the last frame");
        assert_eq!((kept.image.samples, kept.image.flags), (5, FLAG_DONE));
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
            .submit_scene(
                Kind::Final,
                &scene.to_rsb(),
                true,
                "",
                "",
                None,
                PASS_PART_ID,
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
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(timed.frame().pass, 0, "still waiting for the first final");
        assert_eq!(timed.frame().seconds, 0.0, "its clock has not started");
        engine.cancel(long.id);
        let f = wait_done(&timed);
        // With the wait on its clock it would stop after the first pass (one sample).
        assert!(
            f.samples >= 16,
            "{} samples: it rendered for its own 0.3 s after the wait",
            f.samples
        );
        assert!(f.seconds < 2.0, "{} s", f.seconds);
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

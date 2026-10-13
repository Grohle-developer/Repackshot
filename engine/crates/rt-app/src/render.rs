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

use rt_core::image::Film;
use rt_core::integrator::Prepared;
use rt_core::render::{render_tile_prepared, tile_grid};
use rt_core::scene::Scene;
use rt_core::simd::Isa;
use std::collections::{HashMap, VecDeque};
use std::io::{self, Write};
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
    /// Seconds since the job started (until it ended).
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

    /// True when there are no sums yet.
    pub fn is_empty(&self) -> bool {
        self.sums.is_empty()
    }
}

struct Progress {
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
    /// Samples to render.
    pub max_samples: u32,
    budget: Option<Duration>,
    threads: usize,
    cancel: AtomicBool,
    started: Instant,
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
    fn new(id: u32, kind: Kind, scene: &Scene, threads: usize) -> Job {
        let r = &scene.render;
        Job {
            id,
            kind,
            width: r.width,
            height: r.height,
            max_samples: if r.max_samples > 0 {
                r.max_samples
            } else {
                DEFAULT_SAMPLES
            },
            budget: if r.max_seconds > 0.0 {
                Duration::try_from_secs_f32(r.max_seconds).ok()
            } else {
                None
            },
            threads,
            cancel: AtomicBool::new(false),
            started: Instant::now(),
            progress: Mutex::new(Progress {
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
            None => (0, self.started.elapsed().as_secs_f32()),
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
        p.ended = Some((flags, self.started.elapsed().as_secs_f32()));
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

/// Renders `job` (the progressive loop of `rt`), publishing the sums after every pass.
fn render(job: &Job, scene: &Scene, gate: &Gate, isa: Isa) {
    let (width, height) = (job.width, job.height);
    let prepared = Prepared::new(scene);
    let tiles = tile_grid(width, height, TILE_SIZE);
    let threads = job.threads.clamp(1, tiles.len().max(1));
    let films: Vec<Mutex<Film>> = tiles
        .iter()
        .map(|t| Mutex::new(Film::region(t.x, t.y, t.w, t.h)))
        .collect();
    let samples = job.max_samples;
    let (mut done, mut pass, mut passes, mut rays) = (0u32, 1u32, 0u32, 0u64);
    while done < samples && !job.cancelled() {
        let count = pass.min(samples - done);
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
                            for sample in first..first + count {
                                rays += render_tile_prepared(
                                    scene, &prepared, tile, sample, &mut film, isa,
                                );
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
        rays += pass_rays;
        done += count;
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
        if job.budget.is_some_and(|b| job.started.elapsed() >= b) {
            break;
        }
        pass = (pass * 2).min(MAX_PASS_SAMPLES);
    }
    job.end(
        if job.cancelled() {
            FLAG_CANCELLED
        } else {
            FLAG_DONE
        },
        None,
    );
}

/// Why a job was not started.
#[derive(Debug, PartialEq, Eq)]
pub enum SubmitError {
    /// The RSB is not valid.
    BadScene(String),
    /// An update without `MESH` sections, but this client's meshes are not loaded (or are other
    /// meshes): send the whole scene.
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
}

/// The renderer: jobs, their threads and their priority.
#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

impl Engine {
    /// An engine rendering on `threads` threads (0: every hardware thread).
    pub fn new(threads: usize) -> Engine {
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
            }),
        }
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

    /// Starts a job from RSB bytes. `mesh_key` names the geometry (a viewport update without
    /// meshes must name the meshes it expects); `client` tells viewport jobs of different
    /// windows apart.
    pub fn submit(
        &self,
        kind: Kind,
        rsb: &[u8],
        mesh_key: &str,
        client: &str,
    ) -> Result<Arc<Job>, SubmitError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        match kind {
            Kind::Final => {
                if !has_meshes(rsb) {
                    return Err(SubmitError::NeedMeshes);
                }
                let scene =
                    Scene::from_rsb(rsb).map_err(|e| SubmitError::BadScene(e.to_string()))?;
                let job = Arc::new(Job::new(id, kind, &scene, self.inner.threads));
                self.register(&job);
                let (engine, run) = (self.clone(), Arc::clone(&job));
                std::thread::spawn(move || {
                    let inner = &engine.inner;
                    if inner.gate.enter_final(&run) {
                        render(&run, &scene, &inner.gate, inner.isa);
                        inner.gate.exit_final();
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
                let scene = if has_meshes(rsb) {
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
                let job = Arc::new(Job::new(id, kind, &scene, self.inner.threads));
                self.register(&job);
                let (engine, run) = (self.clone(), Arc::clone(&job));
                let handle = std::thread::spawn(move || {
                    render(&run, &scene, &engine.inner.gate, engine.inner.isa);
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
    fn a_final_job_renders_every_sample_and_publishes_passes() {
        let engine = Engine::new(3);
        let scene = small_example(5, 40, 30);
        let job = engine.submit(Kind::Final, &scene.to_rsb(), "", "").unwrap();
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
    fn viewport_jobs_replace_each_other_and_keep_their_meshes() {
        let engine = Engine::new(2);
        let scene = small_example(4096, 64, 48);
        let full = scene.to_rsb();
        let a = engine.submit(Kind::Viewport, &full, "m1", "w").unwrap();
        a.wait_newer(0, Duration::from_secs(60));
        // An update without meshes for the same key: camera moved.
        let mut moved = scene.clone();
        moved.camera.position.x += 10.0;
        moved.render.max_samples = 2;
        let mut update = moved.to_rsb();
        update = strip_meshes(&update);
        assert!(!has_meshes(&update));
        let b = engine.submit(Kind::Viewport, &update, "m1", "w").unwrap();
        assert!(a.frame().flags & FLAG_CANCELLED != 0, "replaced");
        assert!(engine.job(a.id).is_none());
        let fb = wait_done(&b);
        assert_eq!(fb.samples, 2);
        // The same pixels as a full render of the moved scene.
        let c = engine
            .submit(Kind::Viewport, &moved.to_rsb(), "m1", "w")
            .unwrap();
        let fc = wait_done(&c);
        assert_eq!(fb.sums, fc.sums);
        // Another mesh key, or another window that has nothing loaded: send the meshes.
        assert_eq!(
            engine
                .submit(Kind::Viewport, &update, "m2", "w")
                .unwrap_err(),
            SubmitError::NeedMeshes
        );
        assert_eq!(
            engine
                .submit(Kind::Viewport, &update, "m1", "other")
                .unwrap_err(),
            SubmitError::NeedMeshes
        );
        // The refused update did not lose the loaded meshes.
        assert!(engine.submit(Kind::Viewport, &update, "m1", "w").is_ok());
        // A broken update is refused and keeps the meshes too.
        assert!(matches!(
            engine.submit(Kind::Viewport, b"nope", "m1", "w"),
            Err(SubmitError::BadScene(_))
        ));
        assert!(engine.submit(Kind::Viewport, &update, "m1", "w").is_ok());
        assert!(matches!(
            engine.submit(Kind::Final, b"RSB1\0\0\0\0MESH\x01\0\0\0x", "", ""),
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
            )
            .unwrap();
        view.wait_newer(0, Duration::from_secs(60));
        let render = engine
            .submit(Kind::Final, &small_example(64, 96, 64).to_rsb(), "", "")
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
            )
            .unwrap();
        let queued = engine
            .submit(Kind::Final, &small_example(4, 96, 64).to_rsb(), "", "")
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
        let job = engine.submit(Kind::Final, &scene.to_rsb(), "", "").unwrap();
        let f = wait_done(&job);
        assert_eq!(f.flags & FLAG_DONE, FLAG_DONE);
        assert!(f.samples > 0 && f.samples < 1_000_000);
        assert!(f.sums.chunks_exact(4).all(|px| px[3] == f.samples as f32));
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

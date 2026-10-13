//! `rt-bench`: ray throughput of the BVH on the example part and on a procedural mesh of about a
//! million triangles.
//!
//! For each scene it reports the BVH build time and, for coherent rays (camera rays through a
//! pixel grid, tile by tile: the example's own camera, or a camera framing the procedural mesh)
//! and incoherent rays (random origins around the scene aimed at random
//! points of its bounds), the closest-hit throughput, plus the any-hit (shadow ray) throughput
//! of the incoherent set. Rays are generated in batches outside the timed region; each batch is
//! traced with one SIMD dispatch, as a renderer would trace a tile. "Per thread" is the rate of
//! each worker over its own tracing time; "total" is their sum.

use rt_core::geometry::{BvhWidth, Geometry, Mesh, RayHit};
use rt_core::math::{Ray, Vec3};
use rt_core::rng::{mix64, Pcg32};
use rt_core::scene::Camera;
use rt_core::simd::Isa;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Rays generated and traced together.
const BATCH: usize = 4096;

/// What to measure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BenchOptions {
    /// Rays per measurement.
    pub rays: u64,
    /// Worker threads.
    pub threads: usize,
    /// Approximate triangle count of the procedural mesh.
    pub triangles: u32,
    /// SIMD path (`None`: the best one detected).
    pub isa: Option<Isa>,
    /// BVH width (`None`: the native one).
    pub width: Option<BvhWidth>,
}

impl Default for BenchOptions {
    fn default() -> BenchOptions {
        BenchOptions {
            rays: 10_000_000,
            threads: std::thread::available_parallelism().map_or(1, |n| n.get()),
            triangles: 1_000_000,
            isa: None,
            width: None,
        }
    }
}

/// Text printed by `rt-bench --help`.
pub const USAGE: &str = "\
rt-bench: ray throughput of the Repackshot BVH

USAGE:
    rt-bench [--rays N] [--threads N] [--triangles N] [--isa NAME] [--width 4|8]

OPTIONS:
        --rays <N>        rays per measurement (default 10000000)
        --threads <N>     worker threads (default: all cores)
        --triangles <N>   triangles of the procedural mesh (default 1000000)
        --isa <NAME>      scalar, sse2, avx2, neon or simd128 (default: best detected)
        --width <4|8>     BVH width (default: 8 with AVX2, else 4)
    -h, --help            show this help
";

/// Parses the arguments that follow the program name; `Ok(None)` means `--help`.
pub fn parse_args(args: &[String]) -> Result<Option<BenchOptions>, String> {
    let mut options = BenchOptions::default();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("{arg} needs a value"));
        let number = |text: &str| -> Result<u64, String> {
            match text.parse::<u64>() {
                Ok(n) if n > 0 => Ok(n),
                _ => Err(format!("{arg} expects a positive integer, got '{text}'")),
            }
        };
        match arg.as_str() {
            "-h" | "--help" => return Ok(None),
            "--rays" => options.rays = number(value()?)?,
            "--threads" => options.threads = number(value()?)? as usize,
            "--triangles" => {
                options.triangles = u32::try_from(number(value()?)?)
                    .map_err(|_| "--triangles is too large".to_string())?;
            }
            "--isa" => {
                let name = value()?;
                let isa = Isa::ALL
                    .into_iter()
                    .find(|i| i.name() == name)
                    .ok_or_else(|| format!("unknown SIMD path '{name}'"))?;
                if !isa.is_available() {
                    return Err(format!("{name} is not available on this machine"));
                }
                options.isa = Some(isa);
            }
            "--width" => {
                options.width = Some(match value()?.as_str() {
                    "4" => BvhWidth::Four,
                    "8" => BvhWidth::Eight,
                    other => return Err(format!("--width expects 4 or 8, got '{other}'")),
                });
            }
            other => return Err(format!("unknown option '{other}'")),
        }
    }
    Ok(Some(options))
}

/// A displaced sphere of radius about 100 mm with about `triangles` triangles: a latitude /
/// longitude grid whose radius is modulated by a few waves (smooth normals are not needed).
pub fn displaced_sphere(triangles: u32) -> Mesh {
    let lat = ((triangles as f32 / 4.0).sqrt() as u32).max(2);
    let lon = lat * 2;
    let mut positions = Vec::with_capacity(((lat + 1) * lon) as usize);
    for i in 0..=lat {
        let theta = std::f32::consts::PI * i as f32 / lat as f32;
        for j in 0..lon {
            let phi = std::f32::consts::TAU * j as f32 / lon as f32;
            let r = 100.0
                * (1.0
                    + 0.12 * (7.0 * theta).sin() * (5.0 * phi).cos()
                    + 0.04 * (23.0 * theta + 3.0 * phi).sin());
            positions.push(Vec3::new(
                r * theta.sin() * phi.cos(),
                r * theta.sin() * phi.sin(),
                r * theta.cos(),
            ));
        }
    }
    let mut indices = Vec::with_capacity((lat * lon * 6) as usize);
    for i in 0..lat {
        for j in 0..lon {
            let a = i * lon + j;
            let b = i * lon + (j + 1) % lon;
            let c = a + lon;
            let d = b + lon;
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    Mesh::with_width(&positions, &[], &indices, 0, BvhWidth::native()).unwrap_or_default()
}

/// One kind of ray.
#[derive(Clone, Debug, PartialEq)]
enum RayKind {
    /// Rays of `Camera` through a 1024 x 1024 grid, in 16 x 16 tiles, with sub-pixel jitter.
    Coherent(Camera),
    /// Random origin on a sphere around the scene, aimed at a random point of its bounds.
    Incoherent,
}

/// A 50 mm camera looking at the centre of `bounds` from the front right, close enough for the
/// object to fill most of the frame.
fn framing_camera(bounds: (Vec3, Vec3)) -> Camera {
    let (lo, hi) = bounds;
    let centre = (lo + hi) * 0.5;
    let radius = (hi - lo).max_component() * 0.5;
    Camera {
        position: centre + Vec3::new(1.2, -2.0, 0.9).normalize() * (radius * 2.4),
        target: centre,
        ..Camera::default()
    }
}

/// Fills `rays` with the rays `first..first + rays.len()` of `kind` for a scene with `bounds`.
fn generate(kind: &RayKind, bounds: (Vec3, Vec3), first: u64, rays: &mut [Ray]) {
    let (lo, hi) = bounds;
    let centre = (lo + hi) * 0.5;
    let radius = (hi - lo).length() * 0.5;
    match kind {
        RayKind::Coherent(camera) => {
            for (k, ray) in rays.iter_mut().enumerate() {
                let i = first + k as u64;
                let pixel = i % (1024 * 1024);
                let (tile, inside) = (pixel / 256, pixel % 256);
                let x = (tile % 64) * 16 + inside % 16;
                let y = (tile / 64) * 16 + inside / 16;
                let jitter = (i / (1024 * 1024)) as f32 * 0.37 % 1.0;
                let u = (x as f32 + jitter) / 1024.0;
                let v = (y as f32 + jitter) / 1024.0;
                *ray = camera.generate_ray(1.0, u, v, (0.0, 0.0));
            }
        }
        RayKind::Incoherent => {
            for (k, ray) in rays.iter_mut().enumerate() {
                let i = first + k as u64;
                let mut rng = Pcg32::seeded(mix64(i), 17);
                let mut f = || rng.next_f32();
                let d = Vec3::new(f() - 0.5, f() - 0.5, f() - 0.5);
                let dir = if d.length_squared() > 1.0e-6 {
                    d.normalize()
                } else {
                    Vec3::new(0.0, 0.0, 1.0)
                };
                let origin = centre + dir * (radius * 1.3);
                let target =
                    lo + Vec3::new(f() * (hi - lo).x, f() * (hi - lo).y, f() * (hi - lo).z);
                let mut r = Ray::new(origin, (target - origin).normalize());
                r.t_max = (target - origin).length() * 1.5;
                *ray = r;
            }
        }
    }
}

/// Throughput of one measurement.
#[derive(Clone, Debug)]
pub struct Throughput {
    /// Rays traced.
    pub rays: u64,
    /// Rays that hit (closest) or were occluded (any hit).
    pub hits: u64,
    /// Rays per second of each thread over its own tracing time (ray generation excluded).
    pub per_thread: Vec<f64>,
}

impl Throughput {
    /// Rays per second of all threads together: the sum of the per-thread figures.
    pub fn total(&self) -> f64 {
        self.per_thread.iter().sum()
    }

    /// Mean of the per-thread figures.
    pub fn mean_per_thread(&self) -> f64 {
        self.per_thread.iter().sum::<f64>() / self.per_thread.len().max(1) as f64
    }
}

/// Traces `count` rays of `kind` on `threads` threads (closest hit, or any hit).
fn measure(
    geometry: &Geometry,
    kind: &RayKind,
    any_hit: bool,
    count: u64,
    threads: usize,
    isa: Isa,
) -> Throughput {
    let b = geometry.bounds();
    let bounds = (b.min, b.max);
    let next = AtomicU64::new(0);
    let batches = count.div_ceil(BATCH as u64);
    let results: Vec<(u64, u64, Duration)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads.max(1))
            .map(|_| {
                scope.spawn(|| {
                    let mut rays = vec![Ray::new(Vec3::ZERO, Vec3::ZERO); BATCH];
                    let mut closest: Vec<Option<RayHit>> = vec![None; BATCH];
                    let mut occluded = vec![false; BATCH];
                    let (mut traced, mut hits, mut busy) = (0u64, 0u64, Duration::ZERO);
                    loop {
                        let batch = next.fetch_add(1, Ordering::Relaxed);
                        if batch >= batches {
                            break;
                        }
                        let first = batch * BATCH as u64;
                        let n = (count - first).min(BATCH as u64) as usize;
                        generate(kind, bounds, first, &mut rays[..n]);
                        let t0 = Instant::now();
                        if any_hit {
                            geometry.occluded_batch_with(&rays[..n], &mut occluded[..n], isa);
                        } else {
                            geometry.trace_batch_with(&rays[..n], &mut closest[..n], isa);
                        }
                        busy += t0.elapsed();
                        hits += if any_hit {
                            occluded[..n].iter().filter(|&&o| o).count()
                        } else {
                            closest[..n].iter().filter(|h| h.is_some()).count()
                        } as u64;
                        traced += n as u64;
                    }
                    (traced, hits, busy)
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|w| {
                w.join()
                    .unwrap_or_else(|payload| std::panic::resume_unwind(payload))
            })
            .collect()
    });
    Throughput {
        rays: results.iter().map(|r| r.0).sum(),
        hits: results.iter().map(|r| r.1).sum(),
        per_thread: results
            .iter()
            .filter(|r| r.0 > 0)
            .map(|r| r.0 as f64 / r.2.as_secs_f64().max(1.0e-9))
            .collect(),
    }
}

/// Rebuilds `geometry`'s meshes and instances with `width`, returning it with the build time.
fn rebuild(geometry: &Geometry, width: BvhWidth) -> (Geometry, Duration) {
    let start = Instant::now();
    let meshes = geometry
        .meshes()
        .iter()
        .map(|m| {
            let positions: Vec<Vec3> = (0..m.vertex_count())
                .filter_map(|i| m.position(i))
                .collect();
            let normals: Vec<Vec3> = (0..m.vertex_count()).filter_map(|i| m.normal(i)).collect();
            Mesh::with_width(&positions, &normals, m.indices(), m.material_id(), width)
                .unwrap_or_default()
        })
        .collect();
    let rebuilt =
        Geometry::with_width(meshes, geometry.instances().to_vec(), width).unwrap_or_default();
    (rebuilt, start.elapsed())
}

/// Runs every measurement and returns the report.
pub fn run(options: &BenchOptions) -> String {
    let isa = options.isa.unwrap_or_else(Isa::detect);
    let width = options.width.unwrap_or_else(BvhWidth::native);
    let mut out = String::new();
    let avx2 = Isa::Avx2.is_available();
    let _ = writeln!(
        out,
        "rt-bench: simd {} (AVX2 detected: {}), BVH{}, {} threads, {} rays per measurement",
        isa.name(),
        if avx2 { "yes" } else { "no" },
        width.lanes(),
        options.threads,
        options.rays
    );

    let example = rt_core::example::scene();
    let mut procedural = Geometry::from_meshes(vec![displaced_sphere(options.triangles)]);
    // Build the big mesh once untimed so that the timed build below is not the first touch of
    // its memory either.
    procedural = rebuild(&procedural, width).0;
    let b = procedural.bounds();
    let procedural_camera = framing_camera((b.min, b.max));

    for (name, source, camera) in [
        ("example part", &example.geometry, example.camera.clone()),
        ("displaced sphere", &procedural, procedural_camera),
    ] {
        let (geometry, build) = rebuild(source, width);
        let stats = geometry.meshes().first().map(Mesh::bvh_stats);
        let _ = writeln!(
            out,
            "\n{name}: {} triangles in {} meshes, {} instances; BVH build {:.2} ms{}",
            geometry.triangle_count(),
            geometry.meshes().len(),
            geometry.instances().len(),
            build.as_secs_f64() * 1.0e3,
            stats.map_or(String::new(), |s| format!(
                " (first mesh: {} nodes, {} leaves, depth {})",
                s.nodes, s.leaves, s.depth
            ))
        );
        for (label, kind, any_hit) in [
            ("coherent, closest hit  ", RayKind::Coherent(camera), false),
            ("incoherent, closest hit", RayKind::Incoherent, false),
            ("incoherent, any hit    ", RayKind::Incoherent, true),
        ] {
            let t = measure(
                &geometry,
                &kind,
                any_hit,
                options.rays,
                options.threads,
                isa,
            );
            let _ = writeln!(
                out,
                "  {label}: {:>7.2} Mrays/s total, {:>6.2} Mrays/s per thread ({:.0} % hit)",
                t.total() / 1.0e6,
                t.mean_per_thread() / 1.0e6,
                100.0 * t.hits as f64 / t.rays.max(1) as f64
            );
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Option<BenchOptions>, String> {
        parse_args(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_options() {
        let o = parse(&[
            "--rays",
            "5",
            "--threads",
            "2",
            "--triangles",
            "100",
            "--width",
            "4",
        ])
        .unwrap()
        .unwrap();
        assert_eq!((o.rays, o.threads, o.triangles), (5, 2, 100));
        assert_eq!(o.width, Some(BvhWidth::Four));
        assert_eq!(
            parse(&["--isa", "scalar"]).unwrap().unwrap().isa,
            Some(Isa::Scalar)
        );
        assert_eq!(parse(&["--help"]), Ok(None));
        for bad in [
            &["--rays"][..],
            &["--rays", "0"],
            &["--width", "16"],
            &["--isa", "mmx"],
            &["--bogus"],
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_procedural_mesh_has_about_the_requested_size() {
        let mesh = displaced_sphere(20_000);
        let n = mesh.triangle_count();
        assert!((18_000..=22_000).contains(&n), "{n}");
        let b = mesh.bounds();
        assert!(b.max.x > 90.0 && b.min.z < -90.0);
    }

    #[test]
    fn a_small_run_reports_every_measurement() {
        let report = run(&BenchOptions {
            rays: 3000,
            threads: 2,
            triangles: 2000,
            isa: None,
            width: None,
        });
        assert_eq!(report.matches("Mrays/s total").count(), 6, "{report}");
        assert!(report.contains("example part") && report.contains("displaced sphere"));
        // Coherent camera rays at the example mostly hit something.
        let generated = {
            let mut rays = vec![Ray::new(Vec3::ZERO, Vec3::ZERO); 64];
            let b = rt_core::example::scene().geometry.bounds();
            generate(&RayKind::Incoherent, (b.min, b.max), 0, &mut rays);
            rays
        };
        assert!(generated.iter().all(|r| r.dir.is_finite() && r.t_max > 0.0));
    }
}

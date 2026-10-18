//! The acceptance tests of S7 (ROADMAP): a litre poured into a closed glass keeps the volume of
//! its rendered surface within 3 %; honey takes at least five times longer than water to level;
//! nothing goes through the glass; the same scene gives the same particles whatever the run, the
//! chunks or the threads, and the hashes pinned for the WebAssembly check.

use rt_core::math::Vec3;
use rt_phys::liquid::example::{
    litre_spec, pour_spec, tank_spec, LITRE_BOTTOM, LITRE_HEIGHT, LITRE_INNER, POUR_STEPS, TANK,
};
use rt_phys::liquid::{
    frame_bytes, frame_len, mesh_from_frame, read_frame, LiquidParams, LiquidSpec, LiquidWorld,
    Runner, MIN_GAP,
};

/// The liquids the tests pour: the presets' values (src/data/liquids.ts).
const WATER: LiquidParams = LiquidParams::WATER;
const HONEY: LiquidParams = LiquidParams::HONEY;

/// Each chunk of a pass on a thread of its own.
struct Threads;

impl Runner for Threads {
    fn run(&self, jobs: usize, job: &(dyn Fn(usize) -> Vec<f32> + Sync)) -> Vec<Vec<f32>> {
        #[cfg(not(target_family = "wasm"))]
        {
            std::thread::scope(|scope| {
                let handles: Vec<_> = (0..jobs).map(|k| scope.spawn(move || job(k))).collect();
                handles.into_iter().map(|h| h.join().unwrap()).collect()
            })
        }
        #[cfg(target_family = "wasm")]
        {
            (0..jobs).map(job).collect()
        }
    }
}

#[test]
fn a_litre_poured_into_a_closed_glass_keeps_its_volume() {
    // The volume is the rendered surface's: the marching-cubes mesh of the frame record (what
    // the page records and draws), by the divergence theorem over its triangles. The litre falls
    // 80 mm, splashes and settles; from half a second on it is liquid at rest or nearly.
    let spec = litre_spec(WATER);
    let source = &spec.meshes[2];
    let litre = rt_phys::liquid::surface::mesh_volume(&source.positions, &source.indices);
    assert!((litre / 1.0e6 - 1.0).abs() < 1.0e-6, "{litre}");
    let mut w = LiquidWorld::new(&spec);
    // Every particle stands for its share of the litre.
    let held = w.particle_count() as f64 * f64::from(w.spacing(0)).powi(3);
    assert!((held / litre - 1.0).abs() < 1.0e-5);
    let mut at = 0;
    for steps in [180, 360, 480, 600] {
        w.step(steps - at);
        at = steps;
        let mesh = w.surface(0);
        let v = mesh.volume() / litre;
        assert!(
            (v - 1.0).abs() < 0.03,
            "at {:.2} s the surface holds {v:.4} L",
            steps as f32 / 240.0
        );
        assert!(closed(&mesh.indices), "the surface is not closed");
    }
}

/// Every edge of a mesh used as often one way as the other.
fn closed(indices: &[u32]) -> bool {
    let mut directed: Vec<(u32, u32)> = indices
        .chunks_exact(3)
        .flat_map(|t| [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])])
        .collect();
    directed.sort_unstable();
    let count = |e: (u32, u32)| {
        directed.partition_point(|&x| x <= e) - directed.partition_point(|&x| x < e)
    };
    directed
        .iter()
        .all(|&(a, b)| count((a, b)) == count((b, a)))
}

/// How far the liquid in the tank is from level: the largest departure of a sixth of the tank's
/// length from an even sixth of the particles (0: level).
fn unevenness(w: &LiquidWorld) -> f32 {
    let mut count = [0usize; 6];
    for p in w.particles(0) {
        let b = (((p.x + 0.5 * TANK.x) / (TANK.x / 6.0)).floor() as i32).clamp(0, 5) as usize;
        count[b] += 1;
    }
    let even = w.particle_count() as f32 / 6.0;
    count
        .iter()
        .map(|&c| (c as f32 / even - 1.0).abs())
        .fold(0.0, f32::max)
}

/// The liquid is level when every sixth of the tank holds within 10 % of an even share.
const LEVEL: f32 = 0.1;
/// The tests look at the tank every this many steps (1/40 s).
const LOOK: u32 = 6;

#[test]
fn honey_takes_at_least_five_times_longer_than_water_to_level() {
    // A block of 30 × 30 × 60 mm stands against the left wall of a tank 120 mm long and falls
    // over. "Level" (above): the first look from which every later look, to the end of a run of
    // three seconds, finds every sixth of the tank within 10 % of an even share of the liquid.
    let mut water = LiquidWorld::new(&tank_spec(WATER));
    let looks = 3 * 240 / LOOK;
    let mut level_from: Option<u32> = None;
    for k in 1..=looks {
        water.step(LOOK);
        if unevenness(&water) <= LEVEL {
            level_from.get_or_insert(k);
        } else {
            level_from = None;
        }
    }
    let k = level_from.expect("water levels within three seconds");
    let t_water = k as f32 * LOOK as f32 / 240.0;
    assert!(
        t_water > 0.1 && t_water < 2.0,
        "water levels at {t_water} s"
    );
    // Honey, five times as long: still not level, and yet it has flowed (its front has crossed
    // most of the tank: it is a liquid, not a solid that keeps its shape).
    let mut honey = LiquidWorld::new(&tank_spec(HONEY));
    let steps = (5.0 * t_water * 240.0).ceil() as u32;
    honey.step(steps);
    let uneven = unevenness(&honey);
    assert!(
        uneven > LEVEL,
        "honey is level ({uneven:.3}) at {:.2} s, five times water's {t_water:.2} s",
        steps as f32 / 240.0
    );
    let mut xs: Vec<f32> = honey.particles(0).iter().map(|p| p.x).collect();
    xs.sort_by(f32::total_cmp);
    let front = xs[xs.len() * 99 / 100];
    assert!(front > 0.25 * TANK.x, "honey's front is at {front} mm");
}

#[test]
fn nothing_goes_through_the_glass() {
    // Every particle of the poured litre stays inside the glass under its lid, at every frame (a
    // frame every ten steps) of the fall and the splash: no closer to the bottom or the lid than
    // the gap the simulator keeps, and to the side no closer than half of it (a particle by a
    // corner of the 48-gon keeps the gap from the flat it is nearest to, and a little less from
    // the next one).
    let spec = litre_spec(WATER);
    let mut w = LiquidWorld::new(&spec);
    let gap = MIN_GAP * w.spacing(0);
    let slack = 1.0e-3;
    for _ in 0..48 {
        w.step(10);
        for p in w.particles(0) {
            // The inner wall is a 48-gon: the distance to it from inside is the least distance to
            // the lines of its flats, which lie cos(π/48) of the radius from the axis.
            let inradius = LITRE_INNER * (std::f32::consts::PI / 48.0).cos();
            let to_wall = (0..48)
                .map(|k| {
                    let a = std::f32::consts::TAU * (k as f32 + 0.5) / 48.0;
                    inradius - (p.x * a.cos() + p.y * a.sin())
                })
                .fold(f32::MAX, f32::min);
            assert!(
                to_wall >= 0.5 * gap,
                "a particle {to_wall} mm from the wall"
            );
            assert!(
                p.z >= LITRE_BOTTOM + gap - slack,
                "a particle at z = {}",
                p.z
            );
            assert!(
                p.z <= LITRE_HEIGHT - gap + slack,
                "a particle at z = {}",
                p.z
            );
        }
    }
}

/// The pour's particle hash after these steps. The WebAssembly check
/// (`tests/s7-liquid-engine.test.ts`, with the scene and these numbers in
/// `tests/fixtures/liquid-pour.json`) and these tests run as WebAssembly must get the same.
pub const PINNED_POUR: [(u32, u32); 2] = [(30, 0xc7de_a15c), (POUR_STEPS, 0xce0b_812c)];

fn pour_hashes(workers: usize, threads: bool) -> Vec<(u32, u32)> {
    let mut w = LiquidWorld::new(&pour_spec());
    w.set_workers(workers);
    let mut out = Vec::new();
    let mut at = 0;
    for (steps, _) in PINNED_POUR {
        if threads {
            w.step_with(steps - at, &Threads);
        } else {
            w.step(steps - at);
        }
        at = steps;
        out.push((steps, w.hash()));
    }
    out
}

#[test]
fn the_pour_hashes_are_the_pinned_ones() {
    let got = pour_hashes(1, false);
    assert_eq!(got, PINNED_POUR.to_vec(), "{got:#010x?}");
}

#[test]
fn the_particles_do_not_depend_on_the_run_the_chunks_or_the_threads() {
    let first = pour_hashes(1, false);
    for workers in [1, 2, 3, 5, 8, 13] {
        assert_eq!(pour_hashes(workers, false), first, "{workers} chunks");
    }
    // Chunks on threads of their own (WebAssembly test binaries run them one by one).
    assert_eq!(pour_hashes(4, true), first, "four threads");
    // And worlds stepped side by side on threads.
    #[cfg(not(target_family = "wasm"))]
    {
        let handles: Vec<_> = (0..3)
            .map(|_| std::thread::spawn(|| pour_hashes(3, false)))
            .collect();
        for h in handles {
            assert_eq!(h.join().unwrap(), first);
        }
    }
}

#[test]
fn a_frame_record_is_the_particles_to_the_quantum_and_its_surface() {
    let mut w = LiquidWorld::new(&pour_spec());
    w.step(POUR_STEPS);
    let bytes = w.frame(0);
    assert_eq!(bytes.len(), frame_len(w.particles(0).len()));
    assert_eq!(bytes.len() % 12, 0);
    let (points, spacing) = read_frame(&bytes).unwrap();
    assert_eq!(spacing, w.spacing(0));
    let (lo, hi) = w.domain();
    let quantum = (hi - lo) * (1.0 / 65535.0);
    for (a, b) in points.iter().zip(w.particles(0)) {
        let d = (*a - *b).abs();
        assert!(d.x <= quantum.x && d.y <= quantum.y && d.z <= quantum.z);
    }
    // The surface the page draws is the record's, the same bits from the bytes as from the world.
    let mesh = mesh_from_frame(&bytes).unwrap();
    assert_eq!(mesh, w.surface(0));
    assert!(!mesh.indices.is_empty() && closed(&mesh.indices));
    assert!(mesh
        .normals
        .iter()
        .all(|n| (n.length() - 1.0).abs() < 1.0e-3));
    // Bad records.
    assert!(read_frame(b"LQF0").is_err());
    assert!(read_frame(&bytes[..bytes.len() - 12]).is_err());
    let empty = frame_bytes(&[], 2.0, Vec3::ZERO, Vec3::ONE);
    assert_eq!(empty.len(), 36);
    assert!(mesh_from_frame(&empty).unwrap().indices.is_empty());
}

#[test]
fn a_liquid_scene_reads_back_what_was_written() {
    let spec = litre_spec(HONEY);
    let bytes = spec.to_bytes();
    assert_eq!(LiquidSpec::parse(&bytes), Ok(spec));
    assert!(LiquidSpec::parse(b"LIQ1").is_err());
    assert!(LiquidSpec::parse(&bytes[..bytes.len() - 4]).is_err());
    let mut longer = bytes.clone();
    longer.extend_from_slice(&[0, 0, 0, 0]);
    assert!(LiquidSpec::parse(&longer).is_err());
    // A liquid of no spacing is refused.
    let mut bad = litre_spec(WATER);
    bad.liquids[0].spacing = 0.0;
    assert!(LiquidSpec::parse(&bad.to_bytes()).is_err());
}

/// The fixture the interface's WebAssembly check reads: the scene's bytes and the pinned hashes.
#[cfg(not(target_family = "wasm"))]
#[test]
fn the_fixture_is_the_checked_in_one() {
    let mut w = LiquidWorld::new(&pour_spec());
    w.step(POUR_STEPS);
    let triangles = w.surface(0).indices.len() / 3;
    let json = format!(
        "{{\n \"steps\": [{}],\n \"hashes\": [{}],\n \"particles\": {},\n \"triangles\": {},\n \"scene\": \"{}\"\n}}\n",
        PINNED_POUR.iter().map(|p| p.0.to_string()).collect::<Vec<_>>().join(", "),
        PINNED_POUR.iter().map(|p| format!("\"0x{:08x}\"", p.1)).collect::<Vec<_>>().join(", "),
        w.particle_count(),
        triangles,
        base64(&pour_spec().to_bytes()),
    );
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/liquid-pour.json"
    );
    if std::env::var_os("REPACK_WRITE_FIXTURES").is_some() {
        std::fs::write(path, &json).expect("write the fixture");
    }
    let pinned = std::fs::read_to_string(path).unwrap_or_default();
    assert_eq!(
        json, pinned,
        "tests/fixtures/liquid-pour.json is stale: REPACK_WRITE_FIXTURES=1 cargo test -p rt-phys --test liquid"
    );
}

/// The standard base64 alphabet, with padding.
#[cfg(not(target_family = "wasm"))]
fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= c.len() {
                out.push(A[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Pinned hash of the S7 parity scene ([`s7_scene`]: water in its glass, nested by priority) at
/// 4 samples per pixel; `tools/wasm-parity.mjs` checks the module against it (`rt
/// --write-s7-liquid-example`).
const PINNED_S7_LIQUID_4SPP: u32 = 0xb61a_b0fc;

/// FNV-1a over the little-endian bytes of the resolved film (the hash of the render tests and of
/// `tools/wasm-parity.mjs`).
fn film_hash(values: &[f32]) -> u32 {
    values
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .fold(0x811c_9dc5u32, |h, b| {
            (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
        })
}

/// The film of `scene` at 4 samples per pixel on `isa`.
fn render(scene: &rt_core::scene::Scene, isa: rt_core::simd::Isa) -> Vec<f32> {
    use rt_core::render::{render_tile_prepared, tile_grid};
    let (w, h) = (scene.render.width, scene.render.height);
    let prepared = rt_core::integrator::Prepared::new(scene);
    let mut film = rt_core::image::Film::new(w, h);
    for tile in tile_grid(w, h, 32) {
        for sample in 0..4 {
            render_tile_prepared(scene, &prepared, tile, sample, &mut film, isa);
        }
    }
    film.resolve()
}

#[test]
fn the_s7_scene_has_a_pinned_hash_on_every_simd_path() {
    use rt_phys::liquid::example::s7_scene;
    let scene = s7_scene();
    assert_eq!(scene.priorities, vec![0, 2, 1]);
    // Through an RSB round trip: the priorities travel in NEST.
    let read = rt_core::scene::Scene::from_rsb(&scene.to_rsb()).expect("read");
    assert_eq!(read, scene);
    assert!(rt_core::integrator::Prepared::new(&read).nested());
    let mut found = Vec::new();
    for isa in rt_core::simd::Isa::available() {
        let hash = film_hash(&render(&read, isa));
        eprintln!("S7 liquid at 4 spp on {}: {hash:#010x}", isa.name());
        found.push((isa.name(), hash));
    }
    for (isa, hash) in found {
        assert_eq!(hash, PINNED_S7_LIQUID_4SPP, "{isa}");
    }
    // Without the priorities it is another image (the liquid meets its glass as against air).
    let mut plain = read.clone();
    plain.priorities.clear();
    assert_ne!(
        film_hash(&render(&plain, rt_core::simd::Isa::detect())),
        PINNED_S7_LIQUID_4SPP
    );
}

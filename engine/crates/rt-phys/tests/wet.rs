//! S3b: rain and dust on the front glass ([`rt_phys::wet`]). The criteria of the roadmap's S3: a
//! drop on glass tilted 30° stays up to the critical radius of the table and slides past it (against
//! the balance of its weight along the face and the hysteresis of its contact line, worked out here
//! on its own in `f64`); two drops that touch sum their volumes (± 1 %); the trail cleans the dust;
//! the dust on a face at 60° is less than a tenth of the dust on a level one; determinism, by steps
//! and through the frames the page records; the pinned pane and the pinned image of the parity
//! scene through it on every SIMD path.

use rt_core::optics::glass::GlassDrop;
use rt_core::render::{render_tile_prepared, tile_grid};
use rt_core::simd::Isa;
use rt_phys::example::{
    s3b_wet_scene, wet_pane, wet_spec, DUST_REPOSE_DEG, GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG,
    WET_STEPS,
};
use rt_phys::wet::{critical_radius, SourceKind, WetPane, WetSource, WetSpec};

/// Pinned hash of the parity pane after [`WET_STEPS`] ([`WetPane::hash`]); the page's test with
/// the real `rt.wasm` (`tests/s3b-wet.test.ts`) checks the module against it.
const PINNED_WET_PANE: u32 = 0x5e51_1523;
/// Pinned hash of the S3b parity scene ([`s3b_wet_scene`]) at 4 samples per pixel;
/// `tools/wasm-parity.mjs` checks the module against it (`rt --write-s3b-wet-example`).
const PINNED_S3B_WET_4SPP: u32 = 0x6e6e_370c;

/// The gravity of a face `alpha_deg` from the horizontal, looking up, its slope down `-y`, in the
/// pane's axes; and the velocity of something falling straight down at `speed` mm/s.
fn tilted(alpha_deg: f64, speed: f32) -> ([f32; 3], [f32; 3]) {
    let a = alpha_deg.to_radians();
    let g = [0.0, -a.sin() as f32, -a.cos() as f32];
    (g, [0.0, g[1] * speed, g[2] * speed])
}

fn glass(alpha_deg: f64, sources: Vec<WetSource>) -> WetSpec {
    WetSpec {
        seed: 11,
        half_extent: 30.0,
        gravity: tilted(alpha_deg, 0.0).0,
        advancing_deg: GLASS_ADVANCING_DEG,
        receding_deg: GLASS_RECEDING_DEG,
        repose_deg: DUST_REPOSE_DEG,
        sources,
    }
}

/// The volume over the cube of the contact radius of a cap at `deg`, in `f64`.
fn cap_factor(deg: f64) -> f64 {
    let t = deg.to_radians();
    std::f64::consts::PI * (2.0 - 3.0 * t.cos() + t.cos().powi(3)) / (3.0 * t.sin().powi(3))
}

/// The critical contact radius from the tangent balance, in `f64` and SI units: `ρ g V sin α =
/// γ 2a (cos θ_R − cos θ_A)` with `V = K(θ̄) a³`.
fn furmidge_radius_mm(alpha_deg: f64) -> f64 {
    let (gamma, rho, g) = (0.072, 1000.0, 9.81);
    let (ta, tr) = (
        f64::from(GLASS_ADVANCING_DEG),
        f64::from(GLASS_RECEDING_DEG),
    );
    let hysteresis = tr.to_radians().cos() - ta.to_radians().cos();
    let k = cap_factor(0.5 * (ta + tr));
    let a_m = (2.0 * gamma * hysteresis / (rho * g * k * alpha_deg.to_radians().sin())).sqrt();
    a_m * 1000.0
}

#[test]
fn a_drop_on_glass_at_30_degrees_stays_up_to_its_critical_radius_and_slides_past_it() {
    let expected = furmidge_radius_mm(30.0);
    let pane = WetPane::new(glass(30.0, vec![]));
    let a_c = f64::from(pane.critical_radius());
    assert!(
        (a_c - expected).abs() < 0.005 * expected,
        "{a_c} mm against {expected} mm"
    );
    assert!((a_c - 2.0 * furmidge_radius_mm(90.0)).abs() > 0.1); // it depends on the slope
    assert!(
        (f64::from(critical_radius(70.0, 50.0, 1.0)) - furmidge_radius_mm(90.0)).abs() < 0.01,
        "on vertical glass"
    );
    for (share, slides) in [(0.97, false), (0.995, false), (1.005, true), (1.05, true)] {
        let a = (share * expected) as f32;
        let mut p = WetPane::new(glass(30.0, vec![]));
        p.add_drop(0.0, 10.0, a);
        p.step(480);
        let d = p.drops()[0];
        assert_eq!(d.x, 0.0);
        if slides {
            assert!(
                d.y < 10.0 - 1.0,
                "{share}: it slides down the slope ({})",
                d.y
            );
        } else {
            assert_eq!((d.y, d.a), (10.0, a), "{share}: it stays as it was");
        }
    }
    // On a level pane nothing slides, however large.
    let mut level = WetPane::new(glass(0.0, vec![]));
    level.add_drop(0.0, 0.0, 6.0);
    level.step(240);
    assert_eq!(
        level.drops()[0],
        GlassDrop {
            x: 0.0,
            y: 0.0,
            a: 6.0
        }
    );
}

#[test]
fn a_sliding_drop_leaves_water_in_its_trail_and_slides_faster_on_a_steeper_face() {
    let speed = |alpha: f64| {
        let mut p = WetPane::new(glass(alpha, vec![]));
        p.add_drop(0.0, 25.0, 3.2);
        let before = p.water();
        p.step(24);
        let d = p.drops()[0];
        let lost = before - p.water();
        assert!(lost > 0.0 && (lost - p.water_shed()).abs() < 1e-3 * before);
        (25.0 - d.y) / 0.1
    };
    let (v45, v90) = (speed(45.0), speed(90.0));
    assert!(v45 > 0.0 && v90 > v45, "{v45} mm/s at 45°, {v90} at 90°");
    // A drop that runs off the bottom of the pane is gone.
    let mut p = WetPane::new(glass(90.0, vec![]));
    p.add_drop(0.0, -28.0, 3.5);
    p.step(480);
    assert!(p.drops().is_empty());
    assert_eq!(p.run_off(), 1);
}

#[test]
fn two_drops_that_touch_become_one_of_their_summed_volume() {
    let mut p = WetPane::new(glass(0.0, vec![]));
    p.add_drop(-1.0, 0.0, 1.5);
    p.add_drop(1.2, 0.0, 1.0);
    // One that does not touch them stays apart.
    p.add_drop(15.0, 0.0, 1.0);
    let before = p.water();
    p.step(1);
    let drops = p.drops();
    assert_eq!(drops.len(), 2, "{drops:?}");
    let expected = f64::from(before - p.volume(&drops[1]));
    let pair = f64::from(p.volume(&drops[0]));
    assert!(
        (pair - expected).abs() < 0.01 * expected,
        "{pair} against {expected}"
    );
    assert!((f64::from(p.water()) - f64::from(before)).abs() < 1e-5 * f64::from(before));
    // At their centre of mass.
    let (v1, v2) = (1.5f32.powi(3), 1.0f32);
    assert!((drops[0].x - (-v1 + 1.2 * v2) / (v1 + v2)).abs() < 1e-4);
    assert_eq!(
        drops[1],
        GlassDrop {
            x: 15.0,
            y: 0.0,
            a: 1.0
        }
    );
}

#[test]
fn the_trail_of_a_sliding_drop_cleans_the_dust() {
    let mut p = WetPane::new(glass(30.0, vec![]));
    // Dust everywhere, a mote every millimetre.
    for iy in -25..=25 {
        for ix in -25..=25 {
            p.add_mote(ix as f32, iy as f32, 0.15);
        }
    }
    let before = p.dust_cover();
    let a = 1.3 * p.critical_radius();
    p.add_drop(0.0, 20.0, a);
    p.step(240 * 3);
    let motes = p.motes();
    let d = p.drops().first().copied();
    let low = d.map_or(-30.0, |d| d.y);
    // The band the drop ran down is clean; the rest of the pane keeps its dust.
    for m in &motes {
        let inside = m.x.abs() < 0.8 * a && m.y < 20.0 && m.y > low + a;
        assert!(!inside, "a mote left at ({}, {}) in the trail", m.x, m.y);
    }
    assert!(motes
        .iter()
        .any(|m| m.x.abs() > 1.5 * a && m.y > -20.0 && m.y < 15.0));
    assert!(p.dust_cover() < before);
    // Rain on a dusty tilted pane: its drops grow, slide and leave less dust than no rain does.
    let dust = WetSource {
        kind: SourceKind::Dust,
        density: 2.0e-3,
        velocity: tilted(30.0, 300.0).1,
        size_mm: 0.3,
        size_var: 0.3,
    };
    let rain = WetSource {
        kind: SourceKind::Drops,
        density: 2.0e-5,
        velocity: tilted(30.0, 6500.0).1,
        size_mm: 1.6,
        size_var: 0.3,
    };
    let mut dry = WetPane::new(glass(30.0, vec![dust]));
    let mut wet = WetPane::new(glass(30.0, vec![dust, rain]));
    dry.step(240 * 6);
    wet.step(240 * 6);
    assert!(wet.run_off() > 0 || wet.water_shed() > 0.0, "the rain slid");
    assert!(
        wet.dust_cover() < 0.9 * dry.dust_cover(),
        "{} with rain, {} without",
        wet.dust_cover(),
        dry.dust_cover()
    );
}

#[test]
fn dust_on_a_face_at_60_degrees_is_less_than_a_tenth_of_dust_on_a_level_one() {
    let cover = |alpha: f64| {
        let mut p = WetPane::new(glass(
            alpha,
            vec![WetSource {
                kind: SourceKind::Dust,
                density: 1.0e-3,
                velocity: tilted(alpha, 300.0).1,
                size_mm: 0.3,
                size_var: 0.5,
            }],
        ));
        p.step(240 * 10);
        p.dust_cover()
    };
    let (level, thirty, sixty) = (cover(0.0), cover(30.0), cover(60.0));
    assert!(level > 0.01, "{level}");
    assert!(sixty < 0.1 * level, "{sixty} at 60° against {level} level");
    // Below the angle of repose the dust stays (the flux through the face is cos α of the level one).
    let expected = level * 30f32.to_radians().cos();
    assert!(
        (thirty - expected).abs() < 0.1 * expected,
        "{thirty} at 30°"
    );
    // And a face that looks down gets nothing that falls.
    assert_eq!(cover(150.0), 0.0);
}

#[test]
fn rain_lands_at_its_flux_and_never_on_a_face_turned_away() {
    let rain = |alpha: f64| WetSource {
        kind: SourceKind::Drops,
        density: 2.0e-6,
        velocity: tilted(alpha, 6500.0).1,
        size_mm: 1.0,
        size_var: 0.0,
    };
    // A level pane: nothing slides or runs off, so the water is all that landed.
    let mut p = WetPane::new(glass(0.0, vec![rain(0.0)]));
    p.step(240 * 4);
    let drop_volume = std::f32::consts::PI / 6.0;
    let landed = (p.water() / drop_volume) as f64;
    let expected = 2.0e-6 * 6500.0 * 3600.0 * 4.0;
    assert!(
        (landed - expected).abs() < 4.0 * expected.sqrt(),
        "{landed} drops against {expected}"
    );
    // Looking down, vertical rain never reaches the outer face.
    let mut down = WetPane::new(glass(120.0, vec![rain(120.0)]));
    down.step(240 * 4);
    assert!(down.drops().is_empty());
}

#[test]
fn the_pane_is_the_same_whatever_the_steps_and_its_frames_rebuild_it() {
    // Rain sliding on a dusty pane at 30°: drops land, merge and run, motes land and are wiped.
    let spec = glass(
        30.0,
        vec![
            WetSource {
                kind: SourceKind::Dust,
                density: 2.0e-3,
                velocity: tilted(30.0, 300.0).1,
                size_mm: 0.3,
                size_var: 0.3,
            },
            WetSource {
                kind: SourceKind::Drops,
                density: 2.0e-5,
                velocity: tilted(30.0, 6500.0).1,
                size_mm: 1.6,
                size_var: 0.3,
            },
        ],
    );
    let mut once = WetPane::new(spec.clone());
    once.step(600);
    let mut parts = WetPane::new(spec.clone());
    let mut motes: Vec<(f32, f32, f32, bool)> = Vec::new();
    let mut drops: Vec<GlassDrop> = Vec::new();
    let mut wiped = 0;
    for n in [1, 7, 92, 200, 300] {
        parts.step(n);
        let frame = parts.frame();
        let w = |i: usize| u32::from_le_bytes(frame[4 * i..4 * i + 4].try_into().unwrap());
        let f = |i: usize| f32::from_bits(w(i));
        let nd = w(0) as usize;
        drops = (0..nd)
            .map(|k| GlassDrop {
                x: f(1 + 3 * k),
                y: f(2 + 3 * k),
                a: f(3 + 3 * k),
            })
            .collect();
        let mut at = 1 + 3 * nd;
        let (first, added) = (w(at) as usize, w(at + 1) as usize);
        assert_eq!(first, motes.len());
        at += 2;
        for k in 0..added {
            motes.push((f(at + 3 * k), f(at + 3 * k + 1), f(at + 3 * k + 2), true));
        }
        at += 3 * added;
        for k in 0..w(at) as usize {
            // Each mote is carried away once, in the frame it went.
            let m = &mut motes[w(at + 1 + k) as usize];
            assert!(m.3, "a mote carried away twice");
            m.3 = false;
            wiped += 1;
        }
    }
    assert!(wiped > 0, "the rain wiped no dust");
    assert_eq!(parts.steps(), 600);
    assert_eq!(parts.hash(), once.hash());
    assert_eq!(drops, parts.drops());
    let alive: Vec<(f32, f32, f32)> = motes
        .iter()
        .filter(|m| m.3)
        .map(|m| (m.0, m.1, m.2))
        .collect();
    let native: Vec<(f32, f32, f32)> = parts.motes().iter().map(|m| (m.x, m.y, m.r)).collect();
    assert_eq!(alive, native);
    // A pane after more steps is another one.
    once.step(1);
    assert_ne!(once.hash(), parts.hash());
}

#[test]
fn the_parity_pane_has_a_pinned_hash() {
    let pane = wet_pane();
    eprintln!(
        "S3b wet pane after {WET_STEPS} steps: {:#010x}, {} drops, {} motes, {:.1} mm³",
        pane.hash(),
        pane.drops().len(),
        pane.motes().len(),
        pane.water()
    );
    // The wind brings the rain to a lens that looks down; nothing stays of the pollen.
    assert!(pane.drops().len() > 20);
    assert!(pane.motes().is_empty());
    assert!(wet_spec().sources[1].velocity[2] < 0.0);
    assert_eq!(pane.hash(), PINNED_WET_PANE);
}

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

#[test]
fn the_s3b_scene_has_a_pinned_hash_on_every_simd_path() {
    let scene = s3b_wet_scene();
    let glass = scene.glass.as_ref().expect("a pane");
    assert!(glass.layout().is_some());
    assert_eq!(glass.drops(), wet_pane().drops());
    // Through an RSB round trip: the layout travels drop by drop.
    let read = rt_core::scene::Scene::from_rsb(&scene.to_rsb()).expect("read");
    assert_eq!(read, scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut found = Vec::new();
    for isa in Isa::available() {
        let prepared = rt_core::integrator::Prepared::new(&read);
        let mut film = rt_core::image::Film::new(w, h);
        for tile in tile_grid(w, h, 32) {
            for sample in 0..4 {
                render_tile_prepared(&read, &prepared, tile, sample, &mut film, isa);
            }
        }
        let hash = film_hash(&film.resolve());
        eprintln!("S3b wet glass at 4 spp on {}: {hash:#010x}", isa.name());
        found.push((isa.name(), hash));
    }
    for (isa, hash) in found {
        assert_eq!(hash, PINNED_S3B_WET_4SPP, "{isa}");
    }
}

//! U16: the parts that keep dry ([`rt_phys::wet_parts::PART_DRY`] and
//! [`rt_phys::wet_parts::PART_NO_DUST`]), and the critical size of a drop the page's inspector
//! states (`src/core/part-weather.ts`, a port of [`rt_phys::wet::critical_radius`]): a dry roof
//! keeps the part below it dry and stays dry itself; a drip that falls on a dry part is gone; a part
//! without dust takes no dust or snow and still shelters what is below it; the two flags are
//! independent; and the critical radius of every family of the page's table, at several tilts,
//! written to `tests/fixtures/u16-critical.json` for the page's port to match bit for bit.

use rt_core::fmath;
use rt_core::math::Vec3;
use rt_phys::example::{plate_mesh, DUST_REPOSE_DEG, SNOW_REPOSE_DEG};
use rt_phys::math::Quat;
use rt_phys::wet::critical_radius;
use rt_phys::wet_parts::{
    PartsExtras, PartsMesh, PartsSource, PartsSourceKind, PartsSpec, WetPartSpec, WetParts, NEVER,
    NO_BODY, PART_DRY, PART_FILM, PART_NO_DUST,
};
use rt_phys::world::Pose;
use rt_phys::Transform;

/// Paint's angles (the page's family `PAINT`), the default of a part without a material.
const PAINT: (f32, f32) = (85.0, 60.0);

fn part(mesh: u32, transform: Transform, flags: u32) -> WetPartSpec {
    WetPartSpec {
        mesh,
        transform,
        advancing_deg: PAINT.0,
        receding_deg: PAINT.1,
        soak_mm_s: 0.0,
        flags,
        body: NO_BODY,
    }
}

fn spec(meshes: Vec<PartsMesh>, parts: Vec<WetPartSpec>, sources: Vec<PartsSource>) -> PartsSpec {
    PartsSpec {
        seed: 16,
        cell_mm: 1.0,
        max_samples: 400_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes,
        parts,
        sources,
        extras: PartsExtras::default(),
    }
}

fn source(kind: PartsSourceKind, density: f32, velocity: Vec3, size: f32) -> PartsSource {
    PartsSource {
        kind,
        density,
        velocity,
        size_mm: size,
        size_var: 0.0,
    }
}

/// A floor plate of 100 × 100 mm and, 30 mm above its half `x > 0`, a roof of 50 × 100 mm with
/// `roof` flags, under `sources`.
fn roofed(roof: u32, sources: Vec<PartsSource>) -> WetParts {
    WetParts::new(spec(
        vec![
            plate_mesh(100.0, 100.0, 5, 5),
            plate_mesh(50.0, 100.0, 2, 2),
        ],
        vec![
            part(0, Transform::IDENTITY, 0),
            part(1, Transform::translation(Vec3::new(25.0, 0.0, 30.0)), roof),
        ],
        sources,
    ))
}

fn rain() -> PartsSource {
    source(
        PartsSourceKind::Drops,
        1.0e-5,
        Vec3::new(0.0, 0.0, -5000.0),
        0.2,
    )
}

/// The samples of `part` that ever got wet, under the roof (`x > 1`) and in the open (`x < −1`).
fn wet_samples(parts: &WetParts, part: usize) -> (usize, usize) {
    let (mut under, mut open) = (0, 0);
    for s in 0..parts.sample_count() {
        if parts.sample_part(s) != part || parts.wet_step(s) == NEVER {
            continue;
        }
        let x = parts.sample_position(s).x;
        if x > 1.0 {
            under += 1;
        } else if x < -1.0 {
            open += 1;
        }
    }
    (under, open)
}

#[test]
fn a_dry_roof_keeps_the_part_below_it_dry_and_stays_dry_itself() {
    let mut parts = roofed(PART_DRY, vec![rain()]);
    parts.step(240);
    // The roof: no drop, no wet sample.
    assert!(
        parts.drops().iter().all(|d| d.0 != 1),
        "{:?}",
        parts.drops()
    );
    let roof = (0..parts.sample_count())
        .filter(|&s| parts.sample_part(s) == 1 && parts.wet_step(s) != NEVER)
        .count();
    assert_eq!(roof, 0);
    // None of the rain lands on it at all (it is not drawn there to be thrown away).
    assert_eq!(parts.water_lost(), 0.0);
    // The floor: the rain where it is open, none where the roof is in the way.
    let floor: Vec<_> = parts.drops().into_iter().filter(|d| d.0 == 0).collect();
    assert!(floor.iter().all(|d| d.2.x < 1.0), "{floor:?}");
    assert!(floor.iter().any(|d| d.2.x < -1.0));
    let (under, open) = wet_samples(&parts, 0);
    assert_eq!(under, 0);
    assert!(open > 0);
    // The same roof without the flag takes the rain itself, and shelters the floor just the same.
    let mut plain = roofed(0, vec![rain()]);
    plain.step(240);
    assert!(plain.drops().iter().any(|d| d.0 == 1));
    assert_eq!(wet_samples(&plain, 0).0, 0);
}

#[test]
fn a_dry_film_part_and_a_dry_part_that_moves_stay_dry_too() {
    // A set's piece (a film) under the rain: dry, none of its samples wet; without the flag, most.
    let film = |flags: u32| {
        let mut parts = WetParts::new(spec(
            vec![plate_mesh(100.0, 100.0, 4, 4)],
            vec![part(0, Transform::IDENTITY, PART_FILM | flags)],
            vec![source(
                PartsSourceKind::Drops,
                2.0e-6,
                Vec3::new(0.0, 0.0, -5000.0),
                1.0,
            )],
        ));
        parts.step(240 * 5);
        (0..parts.sample_count())
            .filter(|&s| parts.wet_step(s) != NEVER)
            .count()
    };
    assert_eq!(film(PART_DRY), 0);
    assert!(film(0) > 0);
    // A part that moves with a body (here held where it starts): dry, no drop lands on it.
    let moving = |flags: u32| {
        let mut p = part(0, Transform::translation(Vec3::new(0.0, 0.0, 40.0)), flags);
        p.body = 0;
        let mut parts = WetParts::new(spec(
            vec![plate_mesh(100.0, 100.0, 4, 4)],
            vec![p],
            vec![rain()],
        ));
        assert_eq!(parts.moving_parts(), 1);
        let pose = Some(Pose {
            translation: Vec3::new(0.0, 0.0, 40.0),
            rotation: Quat::IDENTITY,
        });
        for _ in 0..240 {
            parts.step_posed(&[pose]);
        }
        // None of the rain lands on it at all (it is not drawn there to be thrown away).
        assert_eq!(parts.water_lost(), 0.0);
        parts.drops().len()
    };
    assert_eq!(moving(PART_DRY), 0);
    assert!(moving(0) > 0);
}

#[test]
fn a_drip_that_falls_on_a_dry_part_is_gone() {
    // A ceiling (facing down) 50 mm above a dry floor, with a drop past what its contact line holds.
    let mut ceiling = plate_mesh(60.0, 60.0, 2, 2);
    ceiling
        .indices
        .chunks_exact_mut(3)
        .for_each(|t| t.swap(1, 2));
    let scene = |floor: u32| {
        spec(
            vec![ceiling.clone(), plate_mesh(200.0, 200.0, 4, 4)],
            vec![
                part(0, Transform::translation(Vec3::new(0.0, 0.0, 50.0)), 0),
                part(1, Transform::IDENTITY, floor),
            ],
            vec![],
        )
    };
    for (floor, dry) in [(PART_DRY, true), (0, false)] {
        let mut parts = WetParts::new(scene(floor));
        parts.add_drop(0, 0, 0.3, 0.3, 400.0);
        let total = parts.water();
        parts.step(240);
        assert!(parts.counts().2 >= 1, "it dripped");
        assert!(parts.falling().is_empty(), "it landed");
        let on_floor = parts.drops().iter().filter(|d| d.0 == 1).count();
        let wet = (0..parts.sample_count())
            .filter(|&s| parts.sample_part(s) == 1 && parts.wet_step(s) != NEVER)
            .count();
        assert_eq!(
            on_floor == 0 && wet == 0,
            dry,
            "{floor}: {on_floor} drops, {wet} wet"
        );
        // Its water is accounted for: on the ceiling, or gone with the dry floor.
        let seen = parts.water() + parts.water_in_air() + parts.water_lost() + parts.water_shed();
        assert!((seen / total - 1.0).abs() < 1e-3, "{seen} of {total}");
    }
}

#[test]
fn a_part_without_dust_takes_no_dust_or_snow_and_still_shelters() {
    let down = Vec3::new(0.0, 0.0, -1000.0);
    let settle = || {
        vec![
            source(PartsSourceKind::Dust, 1.0e-3, down, 0.2),
            source(PartsSourceKind::Snow, 1.0e-6, down, 4.0),
        ]
    };
    let roof_of = |parts: &WetParts, at: fn(&WetParts, usize) -> f32| -> f32 {
        (0..parts.sample_count())
            .filter(|&s| parts.sample_part(s) == 1)
            .map(|s| at(parts, s))
            .sum()
    };
    let floor_of = |parts: &WetParts, at: fn(&WetParts, usize) -> f32, under: bool| -> f32 {
        (0..parts.sample_count())
            .filter(|&s| parts.sample_part(s) == 0)
            .filter(|&s| {
                let x = parts.sample_position(s).x;
                if under {
                    x > 1.0
                } else {
                    x < -1.0
                }
            })
            .map(|s| at(parts, s))
            .sum()
    };
    let dust = |p: &WetParts, s: usize| p.dust_at(s);
    let snow = |p: &WetParts, s: usize| p.snow_at(s);
    let mut bare = roofed(PART_NO_DUST, settle());
    bare.step(480);
    assert_eq!(roof_of(&bare, dust), 0.0);
    assert_eq!(roof_of(&bare, snow), 0.0);
    assert_eq!(floor_of(&bare, dust, true), 0.0);
    assert_eq!(floor_of(&bare, snow, true), 0.0);
    assert!(floor_of(&bare, dust, false) > 0.0);
    assert!(floor_of(&bare, snow, false) > 0.0);
    // The flags are independent: a dry roof still takes dust and snow, and a roof without dust
    // still takes the rain.
    let mut dry = roofed(PART_DRY, settle());
    dry.step(480);
    assert!(roof_of(&dry, dust) > 0.0);
    assert!(roof_of(&dry, snow) > 0.0);
    let mut wet = roofed(PART_NO_DUST, vec![rain()]);
    wet.step(240);
    assert!(wet.drops().iter().any(|d| d.0 == 1));
    // Both: nothing at all on it.
    let mut nothing = roofed(PART_DRY | PART_NO_DUST, {
        let mut all = settle();
        all.push(rain());
        all
    });
    nothing.step(240);
    assert!(nothing.drops().iter().all(|d| d.0 != 1));
    assert_eq!(roof_of(&nothing, dust), 0.0);
    assert_eq!(roof_of(&nothing, snow), 0.0);
}

#[test]
fn the_flags_go_through_the_bytes() {
    let s = spec(
        vec![plate_mesh(10.0, 10.0, 1, 1)],
        vec![part(0, Transform::IDENTITY, PART_DRY | PART_NO_DUST)],
        vec![rain()],
    );
    let back = PartsSpec::parse(&s.to_bytes()).expect("it reads");
    assert_eq!(back.parts[0].flags, PART_DRY | PART_NO_DUST);
    assert_eq!(back, s);
}

/// The page's wettability families (`src/data/wettability.ts`: key, advancing, receding);
/// `tests/u16-weather.test.ts` requires them to be the page's table.
const FAMILIES: [(&str, f32, f32); 8] = [
    ("GLASS", 70.0, 50.0),
    ("PLASTIC", 90.0, 65.0),
    ("METAL", 80.0, 50.0),
    ("PAPER", 100.0, 20.0),
    ("PAINT", 85.0, 60.0),
    ("WOOD", 85.0, 40.0),
    ("FABRIC", 110.0, 40.0),
    ("WATER_REPELLENT", 120.0, 105.0),
];

/// The tilts of the faces, degrees from the horizontal (90: a vertical face).
const TILTS: [f32; 7] = [0.0, 5.0, 15.0, 30.0, 45.0, 60.0, 90.0];

fn critical_json() -> String {
    let mut out = String::from(
        "{\n \"note\": \"Written by the engine's tests (REPACK_WRITE_FIXTURES=1 cargo test -p rt-phys --test wet_parts_u16): rt_phys::wet::critical_radius of every wettability family at several tilts, sin from rt_core::fmath::sin. src/core/part-weather.ts must give the same bits (tests/u16-weather.test.ts).\",\n \"families\": [\n",
    );
    out += &FAMILIES
        .iter()
        .map(|(k, a, r)| format!("  {{\"key\": \"{k}\", \"advancing\": {a}, \"receding\": {r}}}"))
        .collect::<Vec<_>>()
        .join(",\n");
    out += "\n ],\n \"cases\": [\n";
    let mut cases = Vec::new();
    for (k, a, r) in FAMILIES {
        for tilt in TILTS {
            let sin = fmath::sin(tilt * fmath::DEG_TO_RAD);
            let radius = critical_radius(a, r, sin);
            let mm = if radius.is_finite() {
                format!("{radius}")
            } else {
                "null".to_string()
            };
            cases.push(format!(
                "  {{\"family\": \"{k}\", \"tilt\": {tilt}, \"sin\": {}, \"radius\": {}, \"mm\": {mm}}}",
                sin.to_bits(),
                radius.to_bits()
            ));
        }
    }
    out += &cases.join(",\n");
    out += "\n ]\n}\n";
    out
}

#[test]
fn the_critical_radius_of_every_family_is_what_the_page_states() {
    let now = critical_json();
    if std::env::var_os("REPACK_WRITE_FIXTURES").is_some() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/u16-critical.json"
        );
        std::fs::write(path, &now).expect("write the fixture");
        return;
    }
    // Compiled in, so the test needs no file system (the WASI run has none).
    let committed = include_str!("../../../../tests/fixtures/u16-critical.json");
    assert_eq!(
        committed, now,
        "tests/fixtures/u16-critical.json is stale: REPACK_WRITE_FIXTURES=1 cargo test -p rt-phys --test wet_parts_u16"
    );
    // Sanity: the water-repellent surface lets its drops go first, a level face never.
    let vertical = |a: f32, r: f32| critical_radius(a, r, 1.0);
    let (_, a, r) = FAMILIES[7];
    for (k, fa, fr) in &FAMILIES[..7] {
        assert!(vertical(a, r) < vertical(*fa, *fr), "{k}");
    }
    assert!(critical_radius(PAINT.0, PAINT.1, 0.0).is_infinite());
}

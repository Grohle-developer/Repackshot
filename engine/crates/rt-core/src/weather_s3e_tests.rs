//! S3e: the studio floor's weather (`WETG`), the two-byte resolutions of the set's fine samples
//! (`WTP2`) and the dust's motes (the motes tail).

use super::*;
use crate::geometry::{Geometry, Instance, Transform};
use crate::scene::{Floor, FloorMode};

/// A floor of 60 × 40 cells of 10 mm from (−300, −200): wet where x < 0, dusty where y > 0, snowy
/// past x > 200.
fn floor_weather() -> FloorWeather {
    let (nx, ny) = (60u32, 40u32);
    let values = (0..nx * ny)
        .map(|c| {
            let (i, j) = (c % nx, c / nx);
            [
                if i < 30 { 255 } else { 0 },
                if j >= 20 { 200 } else { 0 },
                if i >= 50 { 120 } else { 0 },
            ]
        })
        .collect();
    FloorWeather {
        nx,
        ny,
        x0: -300.0,
        y0: -200.0,
        cell: 10.0,
        z: 0.0,
        porosity: 0.5,
        values,
    }
}

#[test]
fn a_wetg_section_goes_and_comes_back_and_bad_ones_are_refused() {
    let f = floor_weather();
    let bytes = f.encode();
    assert_eq!(bytes.len() % 4, 0);
    assert_eq!(FloorWeather::decode(&bytes), Ok(f.clone()));
    // A newer writer's tail is ignored; a cut one, no cells or a porosity past 1 are refused.
    let mut longer = bytes.clone();
    longer.extend_from_slice(&[0; 8]);
    assert_eq!(FloorWeather::decode(&longer), Ok(f.clone()));
    assert!(FloorWeather::decode(&bytes[..WETG_HEADER + 10]).is_err());
    let mut bad = bytes.clone();
    bad[0..4].copy_from_slice(&0u32.to_le_bytes());
    assert!(FloorWeather::decode(&bad).is_err());
    let mut bad = bytes.clone();
    bad[24..28].copy_from_slice(&2.0f32.to_bits().to_le_bytes());
    assert!(FloorWeather::decode(&bad).is_err());
    let mut bad = bytes;
    bad[16..20].copy_from_slice(&f32::NAN.to_bits().to_le_bytes());
    assert!(FloorWeather::decode(&bad).is_err());
}

#[test]
fn the_floor_reads_its_cells_between_their_centres() {
    let f = floor_weather();
    // At a cell's centre, the cell; between two, the mean; past the cells, nothing.
    let wet = |x: f32| f.at(x, -100.0).unwrap().wet;
    assert_eq!(wet(-295.0), 1.0);
    assert_eq!(wet(-5.0), 1.0);
    assert_eq!(wet(5.0), 0.0);
    assert!((wet(0.0) - 0.5).abs() < 1e-6);
    assert!((wet(2.5) - 0.25).abs() < 1e-6);
    // The border cells hold to the edge.
    assert_eq!(wet(-300.0), 1.0);
    assert!(f.at(-300.1, 0.0).is_none());
    assert!(f.at(0.0, 200.1).is_none());
    let l = f.at(250.0, 100.0).unwrap();
    assert!((l.dust - 200.0 / 255.0).abs() < 1e-6);
    assert!(l.snow > 0.9, "{l:?}");
}

/// The example scene without its floor quad (the sphere and the small sphere), under `FLOR` in
/// `mode`, small.
fn floor_scene(mode: FloorMode) -> Scene {
    let mut scene = crate::example::scene();
    scene.render.width = 48;
    scene.render.height = 36;
    let meshes = scene.geometry.meshes().to_vec();
    let instances: Vec<Instance> = scene
        .geometry
        .instances()
        .iter()
        .enumerate()
        .filter(|(k, _)| *k != 1)
        .map(|(_, i)| *i)
        .collect();
    scene.geometry = Geometry::new(meshes, instances).unwrap();
    scene.floor = Floor {
        mode,
        z: 0.0,
        color: Rgb::splat(0.6),
    };
    scene
}

/// The resolved film of `scene` at 4 samples per pixel.
fn image(scene: &Scene) -> Vec<f32> {
    use crate::render::{render_tile_prepared, tile_grid};
    let prepared = crate::integrator::Prepared::new(scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = crate::image::Film::new(w, h);
    for tile in tile_grid(w, h, 16) {
        for s in 0..4 {
            render_tile_prepared(
                scene,
                &prepared,
                tile,
                s,
                &mut film,
                crate::simd::Isa::detect(),
            );
        }
    }
    film.resolve()
}

#[test]
fn a_floor_with_nothing_on_it_changes_no_pixel_and_its_layers_change_the_image() {
    for mode in [FloorMode::Visible, FloorMode::ShadowCatcher] {
        let plain = floor_scene(mode);
        let before = image(&plain);
        // Clear: the same bits.
        let mut clear = plain.clone();
        let mut f = floor_weather();
        f.values.iter_mut().for_each(|v| *v = [0; 3]);
        clear.set_wet_floor(Some(f)).unwrap();
        assert_eq!(image(&clear), before, "{mode:?}");
        // Wet, dusty and snowy: another image, through RSB (one WETG).
        let mut weathered = plain.clone();
        weathered.set_wet_floor(Some(floor_weather())).unwrap();
        let bytes = weathered.to_rsb();
        let read = Scene::from_rsb(&bytes).expect("read");
        assert_eq!(read.wet_floor, weathered.wet_floor);
        let after = image(&read);
        assert_ne!(after, before, "{mode:?}");
        // Only where the floor is seen: the pixels of the sphere in front stay close.
        let changed = after
            .chunks_exact(3)
            .zip(before.chunks_exact(3))
            .filter(|(a, b)| (a[0] - b[0]).abs() + (a[1] - b[1]).abs() + (a[2] - b[2]).abs() > 1e-3)
            .count();
        assert!(changed > 100, "{mode:?}: {changed}");
        // A second WETG makes the file invalid.
        let at = find_section(&bytes, b"WETG");
        let len = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]]);
        let end = at + 8 + len as usize;
        let mut twice = bytes[..end].to_vec();
        twice.extend_from_slice(&bytes[at..]);
        assert!(Scene::from_rsb(&twice).is_err());
        let mut once = bytes[..end].to_vec();
        once.extend_from_slice(&bytes[end..]);
        assert!(Scene::from_rsb(&once).is_ok());
    }
}

/// The offset of the first section tagged `tag` (its tag) in RSB `bytes`.
fn find_section(bytes: &[u8], tag: &[u8; 4]) -> usize {
    let header = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let mut at = 8 + header;
    while at + 8 <= bytes.len() {
        let len = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]])
            as usize;
        if &bytes[at..at + 4] == tag {
            return at;
        }
        at += 8 + len;
    }
    panic!("no {tag:?}");
}

#[test]
fn a_wtp2_section_carries_two_byte_resolutions_and_a_wetp_keeps_its_bytes() {
    let r: u16 = 300;
    let n = samples_of(u32::from(r)) as usize + 3;
    let w = PartWeather::new(
        0,
        vec![r, 1],
        (0..n).map(|k| [(k % 7) as u8, 0, 0]).collect(),
        60.0,
        0.2,
        vec![],
    )
    .unwrap();
    assert!(w.wide());
    let bytes = w.encode();
    assert_eq!(bytes.len() % 4, 0);
    assert_eq!(PartWeather::decode_wide(&bytes), Ok(w.clone()));
    // Past 4095 steps a triangle is refused.
    assert!(PartWeather::new(0, vec![4096], vec![], 60.0, 0.0, vec![]).is_err());
    // One byte each when they fit: the layout of before, which an S3d reader reads.
    let narrow = PartWeather::new(
        0,
        vec![2, 255],
        vec![[1, 2, 3]; 6 + 32896],
        60.0,
        0.0,
        vec![],
    )
    .unwrap();
    assert!(!narrow.wide());
    let b = narrow.encode();
    assert_eq!(&b[24..26], &[2, 255]);
    assert_eq!(PartWeather::decode(&b), Ok(narrow));
    // In a scene, written as WTP2.
    let mut scene = Scene {
        geometry: Geometry::new(
            vec![Mesh::new(
                &[
                    Vec3::new(0.0, 0.0, 0.0),
                    Vec3::new(600.0, 0.0, 0.0),
                    Vec3::new(0.0, 600.0, 0.0),
                    Vec3::new(600.0, 600.0, 0.0),
                ],
                &[],
                &[0, 1, 2, 1, 3, 2],
                0,
            )
            .unwrap()],
            vec![Instance::new(0, Transform::IDENTITY, 0)],
        )
        .unwrap(),
        materials: vec![Material::default()],
        ..Scene::default()
    };
    scene.set_wet_parts(vec![w.clone()]).unwrap();
    let rsb = scene.to_rsb();
    let at = find_section(&rsb, b"WTP2");
    assert!(at > 0);
    let read = Scene::from_rsb(&rsb).unwrap();
    assert_eq!(read.wet_parts, vec![w]);
}

/// The motes of `dusty(230, 40)` on the 100 mm plate (the page's test reads this number).
const DUSTY_MOTES: usize = 828;

/// A square plate of `half` mm at z = 0 facing up, two triangles.
fn plate(half: f32) -> Mesh {
    let p = [
        Vec3::new(-half, -half, 0.0),
        Vec3::new(half, -half, 0.0),
        Vec3::new(half, half, 0.0),
        Vec3::new(-half, half, 0.0),
    ];
    Mesh::new(&p, &[], &[0, 1, 2, 0, 2, 3], 0).unwrap()
}

/// A part of two triangles of a 100 mm plate, the rows of the first's grid below its middle under
/// dust of `byte` and the rest of it under dust of 50 (thin), the second clean, with the motes of
/// grains of 0.5 mm.
fn dusty(byte: u8, r: u16) -> PartWeather {
    let n = samples_of(u32::from(r)) as usize;
    let mut row = Vec::with_capacity(n);
    for j in 0..=u32::from(r) {
        for _ in 0..=u32::from(r) - j {
            row.push(if 2 * j < u32::from(r) { byte } else { 50 });
        }
    }
    PartWeather::new(
        0,
        vec![r, r],
        (0..2 * n)
            .map(|k| [0, if k < n { row[k] } else { 0 }, 0])
            .collect(),
        60.0,
        0.0,
        vec![],
    )
    .unwrap()
    .with_motes(MoteSpec {
        size_mm: 0.5,
        size_var: 0.4,
        seed: 9,
    })
    .unwrap()
}

#[test]
fn motes_lie_where_the_dust_is_thick_and_name_the_part_they_lie_on() {
    let corners = |t: u32| -> Option<[Vec3; 3]> {
        let p = [
            Vec3::new(-50.0, -50.0, 0.0),
            Vec3::new(50.0, -50.0, 0.0),
            Vec3::new(50.0, 50.0, 0.0),
            Vec3::new(-50.0, 50.0, 0.0),
        ];
        match t {
            0 => Some([p[0], p[1], p[2]]),
            1 => Some([p[0], p[2], p[3]]),
            _ => None,
        }
    };
    // Thin dust: none; thick: on its triangle only, about MOTE_SHARE of the grains its share stands
    // for, each of its size.
    assert!(motes_on(&dusty(50, 40), corners, 100_000).is_empty());
    let w = dusty(230, 40);
    let motes = motes_on(&w, corners, 100_000);
    // The page's twin (src/core/wet-parts.ts `motesOn`, tests/s3e-floor.test.ts) places as many.
    assert_eq!(motes.len(), DUSTY_MOTES);
    let share = 230.0f32 / 255.0;
    let grain = std::f32::consts::PI * 0.0625 * (1.0 + 0.16 / 3.0);
    // Half the rows' samples: (r/2)(r/2 + ... ) of them, about a third of the triangle's area.
    let thick = (0..=40u32)
        .filter(|j| 2 * j < 40)
        .map(|j| 41 - j)
        .sum::<u32>() as f32;
    let want = MOTE_SHARE * -(1.0 - share).ln() * thick * (5000.0 / 861.0) / grain;
    let n = motes.len() as f32;
    assert!((n - want).abs() < 4.0 * want.sqrt() + 2.0, "{n} {want}");
    for m in &motes {
        assert_eq!(m.triangle, 0);
        // On the thick rows only (the barycentric v of its point is y + 50 over 100).
        assert!(
            (m.position.y + 50.0) / 100.0 < (20.0 + 0.5) / 40.0 + 1e-4,
            "{m:?}"
        );
        assert!(m.position.x >= -50.0 - 1e-3 && m.position.x - m.position.y >= -1e-3);
        assert!(m.radius >= 0.25 * 0.6 - 1e-6 && m.radius <= 0.25 * 1.4 + 1e-6);
        assert_eq!(m.normal, Vec3::new(0.0, 0.0, 1.0));
    }
    // The same every time; the budget holds; without the tail, none.
    assert_eq!(motes_on(&w, corners, 100_000), motes);
    assert_eq!(motes_on(&w, corners, 10).len(), 10);
    let mut bare = w.clone();
    bare.motes = None;
    assert!(motes_on(&bare, corners, 100_000).is_empty());
    // The tail goes and comes back, after a shape tail too; a reader of before ignores it.
    let bytes = w.encode();
    assert_eq!(PartWeather::decode(&bytes), Ok(w.clone()));
    let tail = 16;
    let before = PartWeather::decode(&bytes[..bytes.len() - tail]).unwrap();
    assert_eq!(before.motes, None);
    assert!(w
        .clone()
        .with_motes(MoteSpec {
            size_mm: 0.0,
            size_var: 0.0,
            seed: 0
        })
        .is_err());
    // In a scene: one more mesh, instance and material (dust) after the caps, its grains naming
    // the part they lie on in the passes; taken away, nothing is left.
    let mut scene = Scene {
        geometry: Geometry::new(
            vec![plate(50.0)],
            vec![Instance::new(0, Transform::IDENTITY, 0)],
        )
        .unwrap(),
        materials: vec![Material::default()],
        ..Scene::default()
    };
    scene.set_wet_parts(vec![w.clone()]).unwrap();
    let m = scene.motes().expect("motes");
    assert!(scene.caps().is_none());
    assert_eq!((m.mesh, m.instance, m.material), (1, 1, 1));
    assert_eq!(scene.materials[1], dust());
    assert_eq!(scene.file_instances().len(), 1);
    assert_eq!(m.caps as usize, motes.len());
    let mesh = &scene.geometry.meshes()[1];
    assert_eq!(mesh.triangle_count() as u32, MOTE_TRIANGLES * m.caps);
    assert_eq!(scene.pass_instance(1, 5), 0);
    assert_eq!(scene.pass_instance(1, MOTE_TRIANGLES * (m.caps - 1)), 0);
    let read = Scene::from_rsb(&scene.to_rsb()).unwrap();
    assert_eq!(read.motes(), scene.motes());
    // With a drop too, the caps come first and the motes after them.
    let mut with_drop = w.clone();
    with_drop.drops.push(WetDrop {
        triangle: 1,
        position: Vec3::new(-20.0, 20.0, 0.0),
        radius: 2.0,
    });
    scene.set_wet_parts(vec![with_drop]).unwrap();
    assert_eq!(scene.caps().unwrap().instance, 1);
    assert_eq!(scene.motes().unwrap().instance, 2);
    assert_eq!(scene.file_instances().len(), 1);
    assert_eq!(scene.file_materials().len(), 1);
    scene.set_wet_parts(Vec::new()).unwrap();
    assert!(scene.motes().is_none() && scene.caps().is_none());
    assert_eq!(scene.geometry.instances().len(), 1);
    assert_eq!(scene.materials.len(), 1);
}

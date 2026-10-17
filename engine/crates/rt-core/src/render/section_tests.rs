//! The section view (Q1) through the renderer: the pinned hash of the parity scene on every SIMD
//! path, that a scene without a section is the scene of before, and that the image does not
//! depend on the order tiles are rendered in.

use super::tests::{scene_4spp_hash, PINNED_E5_HDRI_4SPP};
use super::*;
use crate::math::Vec3;
use crate::scene::Scene;

/// Pinned hash of the Q1 parity scene ([`crate::example::q1_scene`]) at 4 samples per pixel.
pub(crate) const PINNED_Q1_SECTION_4SPP: u32 = 0x7a41_82ea;

#[test]
fn the_q1_example_has_a_pinned_hash_on_every_platform() {
    // The E5 scene cut in two with a cap, through an RSB round trip (the reader puts the plane in
    // the geometry); `tools/wasm-parity.mjs` checks the real module against it
    // (`rt --write-q1-example`).
    let scene = crate::example::q1_scene();
    assert!(scene.section.is_some() && !scene.geometry.capped_instances().is_empty());
    assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
    for isa in Isa::available() {
        let hash = scene_4spp_hash(&scene, isa);
        eprintln!("Q1 example at 4 spp on {}: {hash:#010x}", isa.name());
        assert_eq!(hash, PINNED_Q1_SECTION_4SPP, "section on {}", isa.name());
    }
}

#[test]
fn a_scene_without_a_section_is_the_scene_of_before() {
    // The same scene with the section taken away is the E5 one, bit for bit: the hash pinned in
    // E5 has not moved.
    let mut scene = crate::example::q1_scene();
    scene.section = None;
    scene.apply_section();
    assert_eq!(scene.geometry.section_plane(), None);
    assert_eq!(scene_4spp_hash(&scene, Isa::detect()), PINNED_E5_HDRI_4SPP);
    // And a plane that cuts nothing (everything on its kept side) changes no pixel either.
    let mut far = crate::example::q1_scene();
    far.section = crate::geometry::SectionPlane::new(Vec3::new(0.0, 0.0, 1.0), 1.0e5, true);
    far.apply_section();
    assert_eq!(scene_4spp_hash(&far, Isa::detect()), PINNED_E5_HDRI_4SPP);
}

#[test]
fn the_passes_see_the_cap_as_the_cut_solid() {
    // The exact passes read the first surface of each pixel: where the section's cap is, that is the cut solid, with
    // its instance, its material and the plane's normal facing the camera.
    use super::passes_tests::passes_of;
    use crate::passes::{PASS_MATERIAL_ID, PASS_NORMAL, PASS_PART_ID};
    let scene = crate::example::q1_scene();
    let (w, h) = (scene.render.width, scene.render.height);
    let tiles: Vec<TileRect> = tile_grid(w, h, 32);
    let passes = passes_of(
        &scene,
        PASS_MATERIAL_ID | PASS_NORMAL | PASS_PART_ID,
        0,
        &tiles,
        Isa::detect(),
    );
    let aspect = w as f32 / h as f32;
    let mut caps = 0;
    for y in 0..h {
        for x in 0..w {
            let ray = scene.camera.generate_ray(
                aspect,
                (x as f32 + 0.5) / w as f32,
                (y as f32 + 0.5) / h as f32,
                (0.0, 0.0),
            );
            let Some(hit) = scene.geometry.trace(&ray) else {
                continue;
            };
            if hit.triangle != crate::scene::CAP_TRIANGLE {
                continue;
            }
            caps += 1;
            let i = (y * w + x) as usize;
            // The glass sphere is instance 0, whose id in the pass is 1 (0 is the background).
            assert_eq!(passes.part_id[i], hit.instance + 1, "pixel {x},{y}");
            assert_eq!(hit.instance, 0);
            let n = &passes.normal[3 * i..3 * i + 3];
            // The plane x = 0 with its normal towards +X, facing the camera that is at +X.
            assert!(
                (n[0] - 1.0).abs() < 1.0e-5 && n[1].abs() < 1.0e-5 && n[2].abs() < 1.0e-5,
                "{n:?}"
            );
            // Its material is the glass's, material 0 (id 1).
            assert_eq!(passes.material_id[i], 1);
        }
    }
    assert!(caps > 500, "{caps} pixels see the cap");
}

#[test]
fn the_floor_of_the_q1_example_is_studio_and_stays_whole_on_the_removed_side() {
    use crate::scene::{INSTANCE_NO_SECTION, INSTANCE_ONE_SIDED};
    let scene = crate::example::q1_scene();
    assert_eq!(scene.geometry.instances()[1].flags, INSTANCE_NO_SECTION);
    let aspect = scene.render.width as f32 / scene.render.height as f32;
    // The corner of the frame nearest to the camera sees the floor in front of the plane x = 0,
    // on the removed side: the floor is there.
    let ray = scene.camera.generate_ray(aspect, 0.92, 0.96, (0.0, 0.0));
    let hit = scene.geometry.trace(&ray).expect("the floor");
    assert_eq!(hit.instance, 1, "{hit:?}");
    assert!(ray.at(hit.t).x > 100.0);
    // The same scene with the floor an ordinary part: the plane takes that half of it away.
    let mut cut = crate::example::q1_scene();
    let mut instances = cut.geometry.instances().to_vec();
    instances[1].flags &= INSTANCE_ONE_SIDED;
    let meshes = std::mem::take(&mut cut.geometry).into_meshes();
    cut.geometry = crate::geometry::Geometry::new(meshes, instances).unwrap();
    cut.apply_section();
    assert_eq!(cut.geometry.trace(&ray), None);
    // And the pictures are not the same.
    assert_ne!(
        scene_4spp_hash(&cut, Isa::detect()),
        scene_4spp_hash(&scene, Isa::detect())
    );
}

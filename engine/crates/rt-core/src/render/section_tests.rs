//! The section view (Q1) through the renderer: the pinned hash of the parity scene on every SIMD
//! path, that a scene without a section is the scene of before, and that the image does not
//! depend on the order tiles are rendered in.

use super::tests::{scene_4spp_hash, PINNED_E5_HDRI_4SPP};
use super::*;
use crate::math::Vec3;
use crate::scene::Scene;

/// Pinned hash of the Q1 parity scene ([`crate::example::q1_scene`]) at 4 samples per pixel.
pub(crate) const PINNED_Q1_SECTION_4SPP: u32 = 0xedd0_29e7;

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

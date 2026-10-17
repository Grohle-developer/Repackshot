//! The `SECT` section (Q1): read, written, ignored by readers that do not know it.

use super::rsb::{RsbError, SECTION_CAP, TAG_SECT};
use super::*;
use crate::geometry::edges::faceted_box;

const UP: Vec3 = Vec3::new(0.0, 0.0, 1.0);

/// The sections of an RSB file: (tag, payload).
fn sections(bytes: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
    let mut out = Vec::new();
    let mut pos = 8usize;
    while pos < bytes.len() {
        let tag = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]];
        let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        out.push((tag, bytes[pos + 8..pos + 8 + len].to_vec()));
        pos += 8 + len;
    }
    out
}

fn with_section(plane: Option<SectionPlane>) -> Scene {
    let mut scene = Scene {
        materials: vec![Material::default()],
        geometry: Geometry::from_meshes(vec![faceted_box(
            Vec3::splat(-50.0),
            Vec3::splat(50.0),
            true,
        )]),
        section: plane,
        ..Scene::default()
    };
    scene.apply_section();
    scene
}

/// `bytes` without its `MESH` sections: what an update sends when the meshes are loaded.
fn without_meshes(bytes: &[u8]) -> Vec<u8> {
    let mut out = bytes[..8].to_vec();
    for (tag, body) in sections(bytes) {
        if &tag != b"MESH" {
            out = appended(out, tag, &body);
        }
    }
    out
}

fn payload(flags: u32, normal: [f32; 3], distance: f32) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&flags.to_le_bytes());
    for v in normal {
        p.extend_from_slice(&v.to_le_bytes());
    }
    p.extend_from_slice(&distance.to_le_bytes());
    p
}

/// `bytes` with one more section appended.
fn appended(mut bytes: Vec<u8>, tag: [u8; 4], payload: &[u8]) -> Vec<u8> {
    bytes.extend_from_slice(&tag);
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

#[test]
fn the_plane_goes_through_a_file_and_back_and_cuts_the_geometry_it_loads() {
    let plane = SectionPlane::new(Vec3::new(0.6, 0.0, 0.8), 12.5, true).unwrap();
    let scene = with_section(Some(plane));
    let bytes = scene.to_rsb();
    let found: Vec<_> = sections(&bytes)
        .into_iter()
        .filter(|(t, _)| *t == TAG_SECT)
        .collect();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].1, payload(SECTION_CAP, [0.6, 0.0, 0.8], 12.5));
    let read = Scene::from_rsb(&bytes).expect("reads");
    assert_eq!(read.section, Some(plane));
    assert_eq!(read.geometry.section_plane(), Some(&plane));
    assert_eq!(read.geometry.capped_instances(), vec![0]);
    assert_eq!(read.to_rsb(), bytes);
    // The geometry it loads is cut: a ray through the removed corner meets nothing there.
    let r = Ray::new(Vec3::new(50.0, 0.0, 300.0), Vec3::new(0.0, 0.0, -1.0));
    assert_eq!(scene.geometry.trace(&r), read.geometry.trace(&r));
    // No cap: the flag is off and the geometry caps nothing.
    let open = SectionPlane::new(UP, 0.0, false).unwrap();
    let bytes = with_section(Some(open)).to_rsb();
    let read = Scene::from_rsb(&bytes).unwrap();
    assert_eq!(read.section, Some(open));
    assert!(read.geometry.capped_instances().is_empty());
}

#[test]
fn a_scene_without_a_section_writes_and_reads_as_before() {
    let bytes = with_section(None).to_rsb();
    assert!(sections(&bytes).iter().all(|(t, _)| *t != TAG_SECT));
    let read = Scene::from_rsb(&bytes).unwrap();
    assert_eq!(read.section, None);
    assert_eq!(read.geometry.section_plane(), None);
    // The section follows the effects and nothing else moved: with it, the other sections are
    // the same bytes in the same order.
    let plane = SectionPlane::new(UP, 3.0, true).unwrap();
    let cut = with_section(Some(plane)).to_rsb();
    let others: Vec<_> = sections(&cut)
        .into_iter()
        .filter(|(t, _)| *t != TAG_SECT)
        .collect();
    assert_eq!(others, sections(&bytes));
}

#[test]
fn trailing_bytes_and_unknown_flags_are_ignored_and_a_long_normal_is_normalised() {
    let bytes = with_section(None).to_rsb();
    // Unknown trailing bytes and unknown flag bits are ignored.
    let long = [payload(0xffff_fffe, [0.0, 0.0, 1.0], 4.0), vec![9, 9, 9, 9]].concat();
    let read = Scene::from_rsb(&appended(bytes.clone(), TAG_SECT, &long)).unwrap();
    assert_eq!(read.section, SectionPlane::new(UP, 4.0, false));
    // A normal that is not unit is normalised.
    let read = Scene::from_rsb(&appended(
        bytes.clone(),
        TAG_SECT,
        &payload(1, [0.0, 2.0, 0.0], 1.0),
    ))
    .unwrap();
    assert_eq!(read.section.unwrap().normal, Vec3::new(0.0, 1.0, 0.0));
}

#[test]
fn a_bad_section_makes_the_file_invalid() {
    let bytes = with_section(None).to_rsb();
    let bad = |p: &[u8]| Scene::from_rsb(&appended(bytes.clone(), TAG_SECT, p));
    assert_eq!(
        bad(&payload(1, [0.0, 0.0, 0.0], 0.0)),
        Err(RsbError::Invalid {
            tag: TAG_SECT,
            reason: "section normal is zero"
        })
    );
    assert!(matches!(
        bad(&payload(1, [f32::NAN, 0.0, 1.0], 0.0)),
        Err(RsbError::Invalid { .. })
    ));
    assert!(matches!(
        bad(&payload(1, [0.0, 0.0, 1.0], f32::INFINITY)),
        Err(RsbError::Invalid { .. })
    ));
    assert_eq!(
        bad(&payload(1, [0.0, 0.0, 1.0], 0.0)[..12]),
        Err(RsbError::SectionTooShort { tag: TAG_SECT })
    );
    // At most one.
    let twice = appended(
        appended(bytes.clone(), TAG_SECT, &payload(1, [0.0, 0.0, 1.0], 0.0)),
        TAG_SECT,
        &payload(1, [0.0, 0.0, 1.0], 1.0),
    );
    assert!(matches!(
        Scene::from_rsb(&twice),
        Err(RsbError::DuplicateSection { .. })
    ));
}

#[test]
fn an_update_without_meshes_sets_or_clears_the_section_and_keeps_the_meshes() {
    let plane = SectionPlane::new(UP, 0.0, true).unwrap();
    let mut scene = with_section(None);
    let triangles = scene.triangle_count();
    // The page's update: the same scene without its meshes, with a section.
    let update = without_meshes(&with_section(Some(plane)).to_rsb());
    scene.update_from_rsb(&update).expect("update");
    assert_eq!(scene.triangle_count(), triangles);
    assert_eq!(scene.section, Some(plane));
    assert_eq!(scene.geometry.capped_instances(), vec![0]);
    let r = Ray::new(Vec3::new(0.0, 0.0, 300.0), Vec3::new(0.0, 0.0, -1.0));
    assert!(scene
        .geometry
        .trace(&r)
        .is_some_and(|h| h.triangle == CAP_TRIANGLE));
    // The next update has none: the whole box again.
    let none = without_meshes(&with_section(None).to_rsb());
    scene.update_from_rsb(&none).expect("update");
    assert_eq!(scene.section, None);
    assert!(scene
        .geometry
        .trace(&r)
        .is_some_and(|h| h.triangle != CAP_TRIANGLE));
}

#[test]
fn an_instance_flagged_as_studio_is_not_cut_after_a_trip_through_a_file() {
    // The model box and a floor slab under it that the page flags as studio.
    let mut scene = Scene {
        materials: vec![Material::default()],
        geometry: Geometry::new(
            vec![
                faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true),
                faceted_box(
                    Vec3::new(-500.0, -500.0, -60.0),
                    Vec3::new(500.0, 500.0, -50.0),
                    true,
                ),
            ],
            vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance {
                    flags: INSTANCE_NO_SECTION,
                    ..Instance::new(1, Transform::IDENTITY, 0)
                },
            ],
        )
        .unwrap(),
        section: SectionPlane::new(Vec3::new(1.0, 0.0, 0.0), 0.0, true),
        ..Scene::default()
    };
    scene.apply_section();
    let bytes = scene.to_rsb();
    let read = Scene::from_rsb(&bytes).expect("reads");
    assert_eq!(read.geometry.instances()[1].flags, INSTANCE_NO_SECTION);
    assert_eq!(read.to_rsb(), bytes);
    // Down over the removed half: the box is gone, the studio floor (instance 1) is not; only
    // the box is capped.
    let down = Ray::new(Vec3::new(25.0, 0.0, 300.0), Vec3::new(0.0, 0.0, -1.0));
    for s in [&scene, &read] {
        let hit = s.geometry.trace(&down).expect("the floor");
        assert_eq!(hit.instance, 1);
        assert_eq!(s.geometry.capped_instances(), vec![0]);
    }
    // An update that sends the instances again keeps it (the flags are the instances').
    let mut updated = Scene::from_rsb(&bytes).unwrap();
    let update = without_meshes(&bytes);
    updated.update_from_rsb(&update).expect("updates");
    assert_eq!(
        updated.geometry.trace(&down).map(|h| h.instance),
        Some(1),
        "still studio after an update"
    );
}

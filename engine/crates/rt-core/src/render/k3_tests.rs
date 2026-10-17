//! The interior cameras (K3) through the renderer: the pinned hashes of the three views of the
//! parity room on every SIMD path; the plan view that hides the ceiling from the camera while the
//! room stays lit by it (the criterion, by the means); the exterior factor, which changes what the
//! camera sees of the environment and nothing else; the instances hidden to the camera in every
//! query and in the exact passes.

use super::tests::scene_4spp_hash;
use super::*;
use crate::example::{
    k3_fisheye_scene, k3_panorama_scene, k3_plan_scene, k3_room, K3_CEILING, K3_WINDOW,
};
use crate::geometry::{Geometry, RayClass, INSTANCE_NO_CAMERA};
use crate::integrator::FirstHit;
use crate::math::Vec3;
use crate::scene::{Camera, Projection, Scene};

/// Pinned hash of the K3 plan view ([`k3_plan_scene`]) at 4 samples per pixel.
pub(crate) const PINNED_K3_PLAN_4SPP: u32 = 0x6efb_1e66;
/// Pinned hash of the K3 equirectangular panorama ([`k3_panorama_scene`]) at 4 samples per pixel.
pub(crate) const PINNED_K3_PANORAMA_4SPP: u32 = 0x96de_8d73;
/// Pinned hash of the K3 fisheye ([`k3_fisheye_scene`]) at 4 samples per pixel.
pub(crate) const PINNED_K3_FISHEYE_4SPP: u32 = 0x9b85_a1b6;

#[test]
fn the_k3_views_have_pinned_hashes_on_every_platform() {
    // Through an RSB round trip (the K3 fields of CAMR, the INST flag); `tools/wasm-parity.mjs`
    // checks the real module against them (`rt --write-k3-plan-example` and the two others). No
    // hash pinned before K3 moved: no scene before it has a panoramic camera, an exterior factor or
    // an instance hidden to the camera.
    let mut found = Vec::new();
    for (name, scene, pinned) in [
        ("plan", k3_plan_scene(), PINNED_K3_PLAN_4SPP),
        ("panorama", k3_panorama_scene(), PINNED_K3_PANORAMA_4SPP),
        ("fisheye", k3_fisheye_scene(), PINNED_K3_FISHEYE_4SPP),
    ] {
        assert_eq!(
            Scene::from_rsb(&scene.to_rsb()).as_ref(),
            Ok(&scene),
            "{name}"
        );
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("K3 {name} at 4 spp on {}: {hash:#010x}", isa.name());
            found.push((name, isa.name(), hash, pinned));
        }
    }
    for (name, isa, hash, pinned) in found {
        assert_eq!(hash, pinned, "{name} on {isa}");
    }
}

/// The resolved film of `scene` at `samples` per pixel (32-pixel tiles).
fn film_of(scene: &Scene, samples: u32) -> Vec<f32> {
    let prepared = Prepared::new(scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    for tile in tile_grid(w, h, 32) {
        for sample in 0..samples {
            render_tile_prepared(scene, &prepared, tile, sample, &mut film, Isa::detect());
        }
    }
    film.resolve()
}

/// The mean luminance of the pixels of `film` (`w` wide) where `keep(x, y)`.
fn mean_where(film: &[f32], w: u32, keep: impl Fn(u32, u32) -> bool) -> f64 {
    let (mut sum, mut n) = (0.0f64, 0u32);
    for (i, px) in film.chunks_exact(3).enumerate() {
        let (x, y) = (i as u32 % w, i as u32 / w);
        if keep(x, y) {
            sum += f64::from(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]);
            n += 1;
        }
    }
    sum / f64::from(n.max(1))
}

/// The scene with its instances' flags changed by `edit` (the meshes and their BVHs kept).
fn with_instances(scene: &Scene, edit: impl Fn(&mut Vec<crate::geometry::Instance>)) -> Scene {
    let mut s = scene.clone();
    let mut instances = s.geometry.instances().to_vec();
    edit(&mut instances);
    let meshes = std::mem::take(&mut s.geometry).into_meshes();
    s.geometry = Geometry::new(meshes, instances).expect("valid instances");
    s
}

/// The plan view lit by the uplight alone (no sky), small: the ceiling is the only thing that
/// sends the uplight's light down to the floor.
fn uplight_plan() -> Scene {
    let mut scene = k3_plan_scene();
    scene.environment.strength = 0.0;
    scene.render.width = 32;
    scene.render.height = 24;
    scene
}

/// True for a pixel of the plan's image that sees only the inside of the room (inside the inner
/// faces of the walls, a pixel of margin): `scene`'s orthographic camera above the origin.
fn inside_room(scene: &Scene) -> impl Fn(u32, u32) -> bool {
    let (w, h) = (scene.render.width as f32, scene.render.height as f32);
    let px = scene.camera.ortho_width / w;
    let half = (
        scene.camera.ortho_width / 2.0,
        scene.camera.ortho_width / 2.0 * h / w,
    );
    move |x, y| {
        let (cx, cy) = (
            -half.0 + (x as f32 + 0.5) * px,
            half.1 - (y as f32 + 0.5) * px,
        );
        cx.abs() < 2000.0 - px && cy.abs() < 1500.0 - px
    }
}

#[test]
fn the_plan_view_hides_the_ceiling_and_the_room_stays_lit_by_it() {
    // The criterion of K3, by the means. Lit by the uplight alone, the floor of the room has the
    // light the white ceiling sends back. (A) the plan from above with the ceiling hidden to the
    // camera; (D) the same plan from a camera inside the room, under the ceiling, which its rays
    // never meet: (A) sees what (D) sees. (B) without the ceiling the uplight's light leaves the
    // room and the floor is far darker; (C) the ceiling visible to the camera covers the room.
    let a = uplight_plan();
    let inside = inside_room(&a);
    let w = a.render.width;
    let samples = 24;
    let mean_a = mean_where(&film_of(&a, samples), w, &inside);
    let mut d = with_instances(&a, |i| i[K3_CEILING].flags &= !INSTANCE_NO_CAMERA);
    d.camera.position.z = 2500.0;
    let mean_d = mean_where(&film_of(&d, samples), w, &inside);
    let b = with_instances(&a, |i| {
        i.remove(K3_CEILING);
    });
    let mean_b = mean_where(&film_of(&b, samples), w, &inside);
    let c = with_instances(&a, |i| i[K3_CEILING].flags &= !INSTANCE_NO_CAMERA);
    let mean_c = mean_where(&film_of(&c, samples), w, &inside);
    eprintln!(
        "plan means: hidden {mean_a:.6}, from under the ceiling {mean_d:.6} ({:+.4} %), without the \
         ceiling {mean_b:.6} ({:.1} %), the ceiling seen {mean_c:.6}",
        100.0 * (mean_d - mean_a) / mean_a,
        100.0 * mean_b / mean_a
    );
    assert!(mean_a > 0.0);
    assert!(
        ((mean_a - mean_d) / mean_a).abs() < 0.01,
        "{mean_a} vs {mean_d}"
    );
    assert!(mean_b < 0.5 * mean_a, "{mean_b} vs {mean_a}");
    assert!(mean_c < 0.1 * mean_a, "{mean_c} vs {mean_a}");
}

#[test]
fn the_exact_passes_of_the_plan_do_not_see_the_ceiling() {
    use super::passes_tests::passes_of;
    use crate::passes::{PASS_DEPTH, PASS_PART_ID};
    let scene = uplight_plan();
    let (w, h) = (scene.render.width, scene.render.height);
    let tiles = tile_grid(w, h, 32);
    let ceiling_id = K3_CEILING as u32 + 1;
    let hidden = passes_of(&scene, PASS_PART_ID | PASS_DEPTH, 0, &tiles, Isa::detect());
    assert!(hidden.part_id.iter().all(|&id| id != ceiling_id));
    // The floor (instance 0) fills the inside of the room, at the floor's depth.
    let inside = inside_room(&scene);
    for y in 0..h {
        for x in 0..w {
            if inside(x, y) {
                let i = (y * w + x) as usize;
                assert!(hidden.part_id[i] != 0, "{x},{y}");
            }
        }
    }
    let seen = with_instances(&scene, |i| i[K3_CEILING].flags &= !INSTANCE_NO_CAMERA);
    let shown = passes_of(&seen, PASS_PART_ID, 0, &tiles, Isa::detect());
    let covered = shown.part_id.iter().filter(|&&id| id == ceiling_id).count();
    assert!(covered > (w * h / 2) as usize, "{covered}");
}

#[test]
fn only_camera_rays_step_over_an_instance_hidden_to_the_camera() {
    // A ray from above through the ceiling: the camera class goes on to the floor, every other
    // class meets the ceiling; by the BVH and by brute force, with a section view that leaves the
    // ceiling whole, and with one that caps its cut (the cap is hidden with it).
    let plan = k3_plan_scene();
    let down = Ray::new(Vec3::new(100.0, 50.0, 4000.0), Vec3::new(0.0, 0.0, -1.0));
    let check = |geometry: &Geometry, what: &str| {
        for isa in Isa::available() {
            let camera = geometry
                .trace_class(&down, isa, RayClass::Camera)
                .expect("a hit");
            assert_eq!(camera.instance, 0, "{what}: the floor");
            for class in [
                RayClass::Secondary,
                RayClass::Shadow,
                RayClass::Rough,
                RayClass::Parts,
            ] {
                let hit = geometry.trace_class(&down, isa, class).expect("a hit");
                assert_eq!(hit.instance as usize, K3_CEILING, "{what}: {class:?}");
            }
            assert!(geometry.occluded_class(&down, isa, RayClass::Shadow));
        }
        assert_eq!(
            geometry
                .brute_force(&down, RayClass::Camera)
                .0
                .map(|h| h.instance),
            Some(0),
            "{what}"
        );
        assert_eq!(
            geometry
                .brute_force(&down, RayClass::Shadow)
                .0
                .map(|h| h.instance as usize),
            Some(K3_CEILING),
            "{what}"
        );
    };
    check(&plan.geometry, "no section");
    // A section along x through the middle of the room that keeps the half the ray is in: the
    // ceiling slab is cut and capped; a camera ray down the cut sees no cap of it.
    let mut cut = plan.clone();
    cut.section = crate::geometry::SectionPlane::new(Vec3::new(1.0, 0.0, 0.0), 1000.0, true);
    cut.apply_section();
    check(&cut.geometry, "a section");
    let on_cut = Ray::new(Vec3::new(999.9, 50.0, 4000.0), Vec3::new(0.0, 0.0, -1.0));
    let seen = cut
        .geometry
        .trace_class(&on_cut, Isa::detect(), RayClass::Camera)
        .expect("a hit");
    assert_ne!(seen.instance as usize, K3_CEILING);
}

#[test]
fn the_exterior_factor_scales_what_the_camera_sees_of_the_environment_and_nothing_else() {
    // The plan at an exterior factor of 0.5 against 1: the pixels outside the room, which see the
    // sky's ground, are exactly half (a power of two scales without rounding); the inside of the
    // room is the same to the bit (the sky lights the room the same).
    let mut half = k3_plan_scene();
    half.render.width = 48;
    half.render.height = 36;
    half.camera.ortho_width = 4800.0;
    let mut one = half.clone();
    one.camera.exterior = 1.0;
    let (a, b) = (film_of(&half, 2), film_of(&one, 2));
    let w = half.render.width;
    let inside = inside_room(&half);
    let px = half.camera.ortho_width / w as f32;
    let (hw, hh) = (2400.0, 2400.0 * 36.0 / 48.0);
    let outside = |x: u32, y: u32| {
        let (cx, cy) = (-hw + (x as f32 + 0.5) * px, hh - (y as f32 + 0.5) * px);
        cx.abs() > 2100.0 + px || cy.abs() > 1600.0 + px
    };
    let (mut outer, mut inner) = (0, 0);
    for (i, (pa, pb)) in a.chunks_exact(3).zip(b.chunks_exact(3)).enumerate() {
        let (x, y) = (i as u32 % w, i as u32 / w);
        if outside(x, y) {
            assert!(pb[0] > 0.0);
            assert_eq!(
                [pa[0], pa[1], pa[2]],
                [pb[0] * 0.5, pb[1] * 0.5, pb[2] * 0.5]
            );
            outer += 1;
        } else if inside(x, y) {
            assert_eq!(pa, pb, "{x},{y}");
            inner += 1;
        }
    }
    assert!(outer > 100 && inner > 600, "{outer} {inner}");
    // In the panorama the window darkens and nothing else does: every pixel that changed is next to
    // one whose centre ray meets the pane (the camera's rays cross its thin glass straight on).
    let pano = k3_panorama_scene();
    let mut bright = pano.clone();
    bright.camera.exterior = 1.0;
    let (dim, full) = (film_of(&pano, 2), film_of(&bright, 2));
    let (w, h) = (pano.render.width, pano.render.height);
    let prepared = Prepared::new(&pano);
    let tracer = BvhTracer {
        geometry: &pano.geometry,
        isa: Isa::detect(),
    };
    let pane = |x: u32, y: u32| {
        let ray = centre_ray(&pano, x, y);
        matches!(
            crate::integrator::first_hit(&pano, &prepared, &tracer, &ray),
            FirstHit::Surface { instance, .. } if instance as usize == K3_WINDOW
        )
    };
    let (mut changed, mut darker) = (0, 0.0f64);
    for y in 0..h {
        for x in 0..w {
            let i = 3 * (y * w + x) as usize;
            if dim[i..i + 3] == full[i..i + 3] {
                continue;
            }
            changed += 1;
            darker +=
                f64::from(full[i] + full[i + 1] + full[i + 2] - dim[i] - dim[i + 1] - dim[i + 2]);
            let near = (y.saturating_sub(1)..=(y + 1).min(h - 1))
                .any(|ny| (x.saturating_sub(1)..=(x + 1).min(w - 1)).any(|nx| pane(nx, ny)));
            assert!(near, "{x},{y} changed away from the window");
        }
    }
    assert!(changed > 20 && darker > 0.0, "{changed} {darker}");
}

#[test]
fn a_room_without_k3_fields_renders_as_it_did() {
    // The flags and fields of K3 at their defaults are the scene of before: a plain camera of the
    // room, written and read, renders the same film as before K3 could (the same bytes too).
    let mut room = k3_room();
    room.camera = Camera {
        position: Vec3::new(1200.0, -900.0, 1500.0),
        target: Vec3::new(-300.0, 600.0, 600.0),
        focal_mm: 24.0,
        ..Camera::default()
    };
    room.render.width = 24;
    room.render.height = 16;
    let bytes = room.to_rsb();
    let read = Scene::from_rsb(&bytes).expect("reads");
    assert_eq!(read.camera.projection, Projection::Standard);
    assert_eq!(
        read.geometry.instances().iter().map(|i| i.flags).max(),
        Some(0)
    );
    assert_eq!(film_of(&read, 1), film_of(&room, 1));
    // The K3 fields written out with a value the standard camera does not read change no pixel
    // either.
    let mut written = room.clone();
    written.camera.fov_y_deg = 179.0;
    assert_eq!(film_of(&written, 1), film_of(&room, 1));
}

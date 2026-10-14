use super::*;
use crate::example::icosphere;
use crate::geometry::Geometry;
use crate::image::Film;
use crate::integrator::Prepared;
use crate::render::{centre_ray, render_tile_photons, tile_grid, TileRect};
use crate::scene::{
    Camera, Environment, Floor, FloorMode, Instance, Light, LightKind, Material, RenderSettings,
    Transform, LIGHT_FLAG_GLOSSY,
};

/// Clear glass of index 1.5 (no absorption, no tint), `roughness`.
fn glass(roughness: f32) -> Material {
    Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness,
        ior: 1.5,
        transmission: 1.0,
        ..Material::default()
    }
}

/// A glass sphere of radius `radius` resting on a white floor (z = 0), lit by `light`, in a black
/// world, with `photons` caustic photons per sample.
fn sphere_scene(radius: f32, light: Light, photons: u32, size: (u32, u32)) -> Scene {
    let sphere = icosphere(Vec3::new(0.0, 0.0, radius), radius, 5);
    Scene {
        camera: Camera {
            position: Vec3::new(0.0, 260.0, 160.0),
            target: Vec3::new(0.0, 15.0, 10.0),
            focal_mm: 50.0,
            sensor_mm: 36.0,
            ..Camera::default()
        },
        materials: vec![glass(0.0)],
        geometry: Geometry::new(vec![sphere], vec![Instance::new(0, Transform::IDENTITY, 0)])
            .expect("valid"),
        lights: vec![light],
        environment: Environment {
            strength: 0.0,
            ..Environment::default()
        },
        floor: Floor {
            mode: FloorMode::Visible,
            z: 0.0,
            color: Rgb::splat(0.8),
        },
        render: RenderSettings {
            width: size.0,
            height: size.1,
            seed: 3,
            max_depth: 12,
            caustic_photons: photons,
            ..RenderSettings::default()
        },
        bitmaps: Vec::new(),
    }
}

/// A delta sun straight above, `irradiance` W/m², glossy.
fn sun_above(irradiance: f32) -> Light {
    Light {
        kind: LightKind::Sun,
        direction: Vec3::new(0.0, 0.0, -1.0),
        power: irradiance,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    }
}

#[test]
fn glass_and_polished_metal_cast_and_the_rest_receives() {
    assert!(is_caster(&glass(0.0)));
    assert!(is_caster(&glass(MAX_ROUGHNESS)));
    assert!(!is_caster(&glass(0.4)));
    let chrome = Material {
        metallic: 1.0,
        roughness: 0.05,
        ..Material::default()
    };
    assert!(is_caster(&chrome));
    assert!(!is_caster(&Material {
        roughness: 0.5,
        ..chrome.clone()
    }));
    // Brushed metal focuses along its brush: roughness 0.28 with anisotropy 0.8 is as sharp as
    // 0.20 across the tangent.
    let brushed = Material {
        roughness: 0.28,
        anisotropy: 0.8,
        ..chrome.clone()
    };
    assert!((sharpest_roughness(&brushed) - 0.28 * 0.28f32.sqrt().sqrt()).abs() < 1.0e-6);
    assert!(is_caster(&brushed));
    assert!(!is_caster(&Material {
        anisotropy: 0.0,
        ..brushed
    }));
    // Plastic (even glossy), and emitters, receive or emit.
    assert!(!is_caster(&Material {
        roughness: 0.0,
        ..Material::default()
    }));
    assert!(!is_caster(&Material {
        kind: crate::scene::MATERIAL_EMISSIVE,
        ..chrome
    }));
}

#[test]
fn nothing_to_focus_or_no_photons_means_no_caustics() {
    let scene = sphere_scene(30.0, sun_above(1000.0), 0, (8, 8));
    assert!(!Prepared::new(&scene).has_caustics());
    let mut with = scene.clone();
    with.render.caustic_photons = 64;
    assert!(Prepared::new(&with).has_caustics());
    // A plastic sphere focuses nothing.
    let mut plastic = with.clone();
    plastic.materials = vec![Material::default()];
    assert!(!Prepared::new(&plastic).has_caustics());
    // A light without the glossy flag sends no photons (it lights only the diffuse lobe).
    let mut diffuse_only = with.clone();
    diffuse_only.lights[0].flags = 0;
    assert!(!Prepared::new(&diffuse_only).has_caustics());
}

/// Fresnel reflectance of unpolarised light (f64), `eta` the index ratio far / near side.
fn fresnel64(cos_i: f64, eta: f64) -> f64 {
    let sin2_t = (1.0 - cos_i * cos_i) / (eta * eta);
    if sin2_t >= 1.0 {
        return 1.0;
    }
    let cos_t = (1.0 - sin2_t).sqrt();
    let rs = (cos_i - eta * cos_t) / (cos_i + eta * cos_t);
    let rp = (eta * cos_i - cos_t) / (eta * cos_i + cos_t);
    0.5 * (rs * rs + rp * rp)
}

type V = [f64; 3];
fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn add(a: V, b: V, s: f64) -> V {
    [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}

/// The flux fraction (of the light entering a ray) a perfect glass sphere of radius `r` centred
/// at `c` sends to the floor z = 0, splitting at every interface by the exact Fresnel term, for
/// at most `events` interactions (as the photons count them).
fn to_floor(o: V, d: V, c: V, r: f64, inside: bool, weight: f64, events: u32) -> f64 {
    if weight < 1.0e-6 {
        return 0.0;
    }
    // Where the ray meets the sphere.
    let oc = add(o, c, -1.0);
    let b = dot(oc, d);
    let disc = b * b - (dot(oc, oc) - r * r);
    let t = if disc > 0.0 {
        let s = disc.sqrt();
        if inside {
            -b + s
        } else if -b - s > 1.0e-9 {
            -b - s
        } else {
            -1.0
        }
    } else {
        -1.0
    };
    if t <= 1.0e-9 || events == 0 {
        // It leaves: towards the floor, or away.
        if inside {
            return 0.0;
        }
        return if d[2] < 0.0 { weight } else { 0.0 };
    }
    let p = add(o, d, t);
    // The floor in between (only outside: the sphere sits on it).
    if !inside && d[2] < 0.0 && -o[2] / d[2] < t {
        return weight;
    }
    let mut n = add(p, c, -1.0);
    let len = dot(n, n).sqrt();
    n = [n[0] / len, n[1] / len, n[2] / len];
    if inside {
        n = [-n[0], -n[1], -n[2]];
    }
    let cos_i = -dot(d, n);
    let eta = if inside { 1.0 / 1.5 } else { 1.5 };
    let f = fresnel64(cos_i, eta);
    let reflected = add(d, n, 2.0 * cos_i);
    let mut sum = to_floor(p, reflected, c, r, inside, weight * f, events - 1);
    if f < 1.0 {
        let sin2_t = (1.0 - cos_i * cos_i) / (eta * eta);
        let cos_t = (1.0 - sin2_t).sqrt();
        let refracted = add([d[0] / eta, d[1] / eta, d[2] / eta], n, cos_i / eta - cos_t);
        sum += to_floor(p, refracted, c, r, !inside, weight * (1.0 - f), events - 1);
    }
    sum
}

#[test]
fn photons_bring_the_flux_a_glass_sphere_sends_to_the_floor() {
    // A sun straight above a glass sphere: every bit of its light that crosses the sphere and
    // lands on the floor is a caustic. The photons' total flux on the floor must be what an exact
    // sphere (f64, Fresnel split at every interface) sends there: E × π R² × the fraction.
    let (radius, e) = (30.0f32, 1000.0f32);
    let scene = sphere_scene(radius, sun_above(e), 200_000, (8, 8));
    let prepared = Prepared::new(&scene);
    let map = PhotonMap::trace(&scene, &prepared, 0, Isa::detect());
    let on_floor: f64 = map
        .photons()
        .iter()
        .filter(|p| p.normal.z > 0.5 && p.position.z == 0.0)
        .map(|p| f64::from(p.power.g))
        .sum();
    assert!(map.len() > 100_000, "{} photons stored", map.len());

    let (r, c) = (f64::from(radius), [0.0, 0.0, f64::from(radius)]);
    let rings = 2000;
    let mut fraction = 0.0f64;
    for i in 0..rings {
        // Midpoint rule over the disc in rings of equal width (axial symmetry).
        let b = (i as f64 + 0.5) / rings as f64 * r;
        let area = 2.0 * std::f64::consts::PI * b * (r / rings as f64);
        let landed = to_floor([b, 0.0, 10.0 * r], [0.0, 0.0, -1.0], c, r, false, 1.0, 11);
        fraction += area * landed;
    }
    let expected = f64::from(e) * fraction * 1.0e-6;
    let ratio = on_floor / expected;
    eprintln!(
        "floor flux: photons {on_floor:.6} W, exact sphere {expected:.6} W, ratio {ratio:.4}"
    );
    assert!((ratio - 1.0).abs() < 0.03, "ratio {ratio}");
}

#[test]
fn the_kernel_estimates_irradiance() {
    // Photons spread evenly over a square of the floor: a gather anywhere inside gives the
    // irradiance, flux over area.
    let scene = sphere_scene(30.0, sun_above(1000.0), 16, (64, 48));
    let prepared = Prepared::new(&scene);
    let side = 400.0f32;
    let n = 400usize;
    let mut rng = Pcg32::seeded(9, 1);
    let photons: Vec<Photon> = (0..n * n)
        .map(|_| Photon {
            position: Vec3::new(
                (rng.next_f32() - 0.5) * side,
                (rng.next_f32() - 0.5) * side,
                0.0,
            ),
            wi: Vec3::new(0.0, 0.0, 1.0),
            power: Rgb::splat(1.0e-4),
            normal: Vec3::new(0.0, 0.0, 1.0),
            bounces: 1,
            catcher: false,
        })
        .collect();
    let map = PhotonMap::build(&prepared, 0, photons, 0);
    let expected = (n * n) as f32 * 1.0e-4 / (side * side * 1.0e-6);
    let mut mean = 0.0f32;
    let points = 64;
    for i in 0..points {
        let p = Vec3::new(
            (i % 8) as f32 * 30.0 - 105.0,
            (i / 8) as f32 * 30.0 - 105.0,
            0.0,
        );
        let e = map
            .gather(p, Vec3::new(0.0, 0.0, 1.0), 8, false, |_| Rgb::WHITE)
            .g;
        mean += e / points as f32;
        // The other side of the floor, too many casters crossed, or the catcher's: nothing.
        let up = Vec3::new(0.0, 0.0, 1.0);
        assert_eq!(map.gather(p, -up, 8, false, |_| Rgb::WHITE), Rgb::BLACK);
        assert_eq!(map.gather(p, up, 0, false, |_| Rgb::WHITE), Rgb::BLACK);
        assert_eq!(map.gather(p, up, 8, true, |_| Rgb::WHITE), Rgb::BLACK);
    }
    eprintln!(
        "irradiance {mean} against {expected} (radius {} mm)",
        map.radius()
    );
    assert!((mean / expected - 1.0).abs() < 0.05, "{mean} vs {expected}");
}

#[test]
fn a_map_is_the_same_bits_however_its_photons_are_split_and_on_every_isa() {
    let light = Light {
        kind: LightKind::Disk,
        position: Vec3::new(0.0, -200.0, 220.0),
        direction: Vec3::new(0.0, 200.0, -190.0).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 20.0,
        power: 2.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let scene = sphere_scene(30.0, light, 3000, (32, 24));
    let prepared = Prepared::new(&scene);
    let whole = PhotonMap::trace(&scene, &prepared, 5, Isa::detect());
    assert!(!whole.is_empty());
    for split in [2u32, 3, 7, 16] {
        let mut photons = Vec::new();
        let mut rays = 0;
        for k in 0..split {
            let range = 3000 * k / split..3000 * (k + 1) / split;
            let (part, r) = PhotonMap::trace_range(&scene, &prepared, 5, range, Isa::detect());
            photons.extend(part);
            rays += r;
        }
        assert_eq!(
            PhotonMap::build(&prepared, 5, photons, rays),
            whole,
            "{split} parts"
        );
    }
    for isa in Isa::available() {
        assert_eq!(
            PhotonMap::trace(&scene, &prepared, 5, isa),
            whole,
            "{}",
            isa.name()
        );
    }
    // Another pass has other photons and a smaller radius.
    let next = PhotonMap::trace(&scene, &prepared, 6, Isa::detect());
    assert_ne!(next.photons(), whole.photons());
    assert!(next.radius() < whole.radius());
}

#[test]
fn the_radius_shrinks_as_knaus_and_zwicker_say() {
    let scene = sphere_scene(30.0, sun_above(1000.0), 16, (64, 48));
    let setup = Prepared::new(&scene).caustics.expect("caustics");
    let r1 = setup.radius(0);
    // r_{i+1}² / r_i² = (i + α) / (i + 1).
    for i in 1..50u32 {
        let (a, b) = (setup.radius(i - 1), setup.radius(i));
        let want = (i as f32 + RADIUS_ALPHA) / (i as f32 + 1.0);
        assert!(((b * b) / (a * a) - want).abs() < 1.0e-5);
    }
    // Asymptotically r_i ~ i^((α - 1) / 2): a thousand passes shrink it by about 1000^(-1/6).
    let ratio = setup.radius(999) / r1;
    assert!(ratio > 0.25 && ratio < 0.45, "{ratio}");
    // The first radius is RNDR.caustic_radius pixels at the target distance (3 by default).
    let footprint = pixel_footprint(&scene);
    assert!((r1 - 3.0 * footprint).abs() < 1.0e-4 * r1);
    let mut wider = scene.clone();
    wider.render.caustic_radius = 6.0;
    let r_wide = Prepared::new(&wider).caustics.expect("caustics").radius(0);
    assert!((r_wide - 2.0 * r1).abs() < 1.0e-4 * r1);
}

/// Renders samples `0..spp` of the whole scene, with the photon map of every sample when
/// `caustics` is set (else the path tracer alone, with the photons switched off), and returns
/// the film.
fn render(scene: &Scene, spp: u32, caustics: bool) -> Film {
    let mut scene = scene.clone();
    if !caustics {
        scene.render.caustic_photons = 0;
    }
    let prepared = Prepared::new(&scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    for sample in 0..spp {
        let map = caustics.then(|| PhotonMap::trace(&scene, &prepared, sample, Isa::detect()));
        for tile in tile_grid(w, h, 16) {
            render_tile_photons(
                &scene,
                &prepared,
                map.as_ref(),
                tile,
                sample,
                &mut film,
                Isa::detect(),
            );
        }
    }
    film
}

#[test]
fn caustics_replace_the_paths_of_the_tracer_without_counting_twice() {
    // A glass sphere under a large glossy disc light, which the path tracer alone finds well
    // enough by BSDF sampling: in the sphere's shadow, every bit of light is caustic. With the
    // photon map the tracer leaves those paths out and the map brings them; the region must get
    // the same light as the path tracer's (long) reference: twice as much would be counting it
    // twice, none would be losing it.
    let light = Light {
        kind: LightKind::Disk,
        position: Vec3::new(0.0, -160.0, 200.0),
        direction: Vec3::new(0.0, 160.0, -170.0).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 160.0,
        power: 2.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let scene = sphere_scene(30.0, light, 4096, (40, 30));
    let reference = render(&scene, 768, false).resolve();
    let with = render(&scene, 192, true).resolve();
    // The floor in the shadow of the light's centre (the sphere is in the way), seen from the
    // camera's pixel centres, and the floor in the open.
    let centre = scene.lights[0].position;
    let (mut shadow, mut open) = (Vec::new(), Vec::new());
    for y in 0..30u32 {
        for x in 0..40u32 {
            let ray = centre_ray(&scene, x, y);
            if ray.dir.z >= 0.0 || scene.geometry.trace(&ray).is_some() {
                continue;
            }
            let p = ray.at(-ray.origin.z / ray.dir.z);
            let to_light = (centre - p).normalize();
            let blocked = scene
                .geometry
                .trace(&Ray::new(p + Vec3::new(0.0, 0.0, 1.0e-3), to_light))
                .is_some();
            (if blocked { &mut shadow } else { &mut open }).push((y * 40 + x) as usize);
        }
    }
    assert!(shadow.len() >= 12, "{} shadow pixels", shadow.len());
    let mean = |img: &[f32], px: &[usize]| -> f32 {
        px.iter().map(|&i| img[i * 3 + 1]).sum::<f32>() / px.len() as f32
    };
    let (ref_shadow, with_shadow) = (mean(&reference, &shadow), mean(&with, &shadow));
    let (ref_open, with_open) = (mean(&reference, &open), mean(&with, &open));
    eprintln!(
        "shadow: reference {ref_shadow:.4}, with caustics {with_shadow:.4}; open floor: \
         {ref_open:.4}, {with_open:.4}"
    );
    // The caustic is a good part of the light there (the test means something)...
    assert!(ref_shadow > 0.15 * ref_open, "{ref_shadow} vs {ref_open}");
    // ...and both ways give the same.
    assert!(
        (with_shadow / ref_shadow - 1.0).abs() < 0.08,
        "shadow {with_shadow} vs {ref_shadow}"
    );
    assert!(
        (with_open / ref_open - 1.0).abs() < 0.03,
        "open {with_open} vs {ref_open}"
    );
}

/// Mean green of the floor pixels (centre rays that meet no geometry) for which `keep(point)` holds.
fn floor_mean(scene: &Scene, img: &[f32], keep: &dyn Fn(Vec3) -> bool) -> (f32, usize) {
    let (w, h) = (scene.render.width, scene.render.height);
    let mut px = Vec::new();
    for y in 0..h {
        for x in 0..w {
            let ray = centre_ray(scene, x, y);
            if ray.dir.z >= 0.0 || scene.geometry.trace(&ray).is_some() {
                continue;
            }
            if keep(ray.at(-ray.origin.z / ray.dir.z)) {
                px.push((y * w + x) as usize);
            }
        }
    }
    let mean = px.iter().map(|&i| img[i * 3 + 1]).sum::<f32>() / px.len().max(1) as f32;
    (mean, px.len())
}

#[test]
fn polished_metal_s_light_comes_once_through_next_event_estimation_too() {
    // A disc light facing up, under a polished (0.2 rough) metal sphere: the floor never sees the
    // light, only its reflection in the sphere, so all of its light is caustic. The photon map
    // brings it; the path tracer must leave out both its BSDF-sampled hits of the light and its
    // next-event estimation at the metal (which, unlike smooth glass, takes a good share of that
    // light). Checked against the path tracer alone.
    let light = Light {
        kind: LightKind::Disk,
        position: Vec3::new(0.0, 0.0, 100.0),
        direction: Vec3::new(0.0, 0.0, 1.0),
        up: Vec3::new(0.0, 1.0, 0.0),
        size_x: 40.0,
        power: 2.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let mut scene = sphere_scene(30.0, light, 4096, (40, 30));
    scene.geometry = Geometry::new(
        vec![icosphere(Vec3::new(0.0, 0.0, 190.0), 40.0, 5)],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
    )
    .expect("valid");
    scene.materials = vec![Material {
        base_color: Rgb::splat(0.9),
        metallic: 1.0,
        roughness: 0.2,
        ..Material::default()
    }];
    assert!(is_caster(&scene.materials[0]));
    let reference = render(&scene, 768, false).resolve();
    let with = render(&scene, 192, true).resolve();
    // The floor, but not where the camera's ray crosses the light on its way (it shows the light
    // itself, the same both ways).
    let camera = scene.camera.position;
    let lit = |p: Vec3| {
        let t = (camera.z - 100.0) / (camera.z - p.z);
        let q = camera + (p - camera) * t;
        (q.x * q.x + q.y * q.y).sqrt() > 30.0
    };
    let (r, n) = floor_mean(&scene, &reference, &lit);
    let (c, _) = floor_mean(&scene, &with, &lit);
    eprintln!("floor under the metal sphere ({n} px): reference {r:.4}, with caustics {c:.4}");
    assert!(n >= 200 && r > 0.02, "{n} px, {r}");
    assert!((c / r - 1.0).abs() < 0.06, "{c} vs {r}");
}

#[test]
fn photons_aimed_at_overlapping_casters_take_the_density_of_every_cone() {
    // Two glass spheres, the small one between the light and the big one: directions towards the
    // small one are inside both cones, and their density is the mixture's, or the caustics come
    // out too bright. Checked against the path tracer alone under a large light.
    let light = Light {
        kind: LightKind::Disk,
        position: Vec3::new(0.0, -160.0, 200.0),
        direction: Vec3::new(0.0, 160.0, -170.0).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 160.0,
        power: 2.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let mut scene = sphere_scene(30.0, light, 4096, (40, 30));
    let small = icosphere(Vec3::new(0.0, -40.0, 72.5), 12.0, 4);
    let big = icosphere(Vec3::new(0.0, 0.0, 30.0), 30.0, 5);
    scene.geometry = Geometry::new(
        vec![big, small],
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(1, Transform::IDENTITY, 0),
        ],
    )
    .expect("valid");
    assert_eq!(
        Prepared::new(&scene)
            .caustics
            .expect("caustics")
            .spheres
            .len(),
        2
    );
    let reference = render(&scene, 768, false).resolve();
    let with = render(&scene, 192, true).resolve();
    let centre = scene.lights[0].position;
    let shadow = |p: Vec3| {
        scene
            .geometry
            .trace(&Ray::new(
                p + Vec3::new(0.0, 0.0, 1.0e-3),
                (centre - p).normalize(),
            ))
            .is_some()
    };
    let (r, n) = floor_mean(&scene, &reference, &shadow);
    let (c, _) = floor_mean(&scene, &with, &shadow);
    eprintln!("shadow of the two spheres ({n} px): reference {r:.4}, with caustics {c:.4}");
    assert!(n >= 12);
    assert!((c / r - 1.0).abs() < 0.08, "{c} vs {r}");
}

#[test]
fn a_tile_with_caustics_is_the_same_bits_in_any_order_and_without_a_map_it_is_the_path_tracer() {
    let scene = sphere_scene(30.0, sun_above(800.0), 2000, (24, 16));
    let prepared = Prepared::new(&scene);
    let map = PhotonMap::trace(&scene, &prepared, 2, Isa::detect());
    let tile = TileRect {
        x: 0,
        y: 0,
        w: 24,
        h: 16,
    };
    let mut a = Film::new(24, 16);
    render_tile_photons(
        &scene,
        &prepared,
        Some(&map),
        tile,
        2,
        &mut a,
        Isa::detect(),
    );
    let mut b = Film::new(24, 16);
    for t in tile_grid(24, 16, 5).into_iter().rev() {
        render_tile_photons(&scene, &prepared, Some(&map), t, 2, &mut b, Isa::detect());
    }
    assert_eq!(a, b);
    // A map of another sample index is ignored: the tile is the path tracer's.
    let mut other = Film::new(24, 16);
    render_tile_photons(
        &scene,
        &prepared,
        Some(&map),
        tile,
        3,
        &mut other,
        Isa::detect(),
    );
    let mut none = Film::new(24, 16);
    render_tile_photons(&scene, &prepared, None, tile, 3, &mut none, Isa::detect());
    assert_eq!(other, none);
    let mut off = scene.clone();
    off.render.caustic_photons = 0;
    let mut plain = Film::new(24, 16);
    crate::render::render_tile(&off, tile, 3, &mut plain);
    assert_eq!(none, plain);
}

/// Two triangles: the square `[-h, h]²` at height `z`, facing `+z` when `up`.
fn square(h: f32, z: f32, up: bool) -> Vec<[Vec3; 3]> {
    let (a, b, c, d) = (
        Vec3::new(-h, -h, z),
        Vec3::new(h, -h, z),
        Vec3::new(h, h, z),
        Vec3::new(-h, h, z),
    );
    if up {
        vec![[a, b, c], [a, c, d]]
    } else {
        vec![[a, c, b], [a, d, c]]
    }
}

fn mesh_of(triangles: &[[Vec3; 3]], material: u32) -> crate::scene::Mesh {
    let positions: Vec<Vec3> = triangles.iter().flatten().copied().collect();
    let indices: Vec<u32> = (0..positions.len() as u32).collect();
    crate::scene::Mesh::new(&positions, &[], &indices, material).expect("valid")
}

/// A glossy disc light inside a glass ball (r 40 mm, on the floor), facing a white wall behind the
/// ball: every path from a receiver to the light crosses the glass, so all of the light on the
/// floor and the wall is caustic, and much of it on the floor in front of the ball is the wall's
/// caustic seen through a diffuse bounce (`L C R R E`).
fn enclosed_light_scene() -> Scene {
    let light = Light {
        kind: LightKind::Disk,
        position: Vec3::new(0.0, -5.0, 40.0),
        direction: Vec3::new(0.0, -1.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 50.0,
        power: 2.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let mut scene = sphere_scene(40.0, light, 4096, (40, 30));
    let (a, b, c, d) = (
        Vec3::new(-200.0, -80.0, 0.0),
        Vec3::new(200.0, -80.0, 0.0),
        Vec3::new(200.0, -80.0, 160.0),
        Vec3::new(-200.0, -80.0, 160.0),
    );
    scene.materials = vec![
        glass(0.0),
        Material {
            base_color: Rgb::splat(0.8),
            ..Material::default()
        },
    ];
    scene.geometry = Geometry::new(
        vec![
            icosphere(Vec3::new(0.0, 0.0, 40.0), 40.0, 5),
            mesh_of(&[[a, c, b], [a, d, c]], 1),
        ],
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(1, Transform::IDENTITY, 1),
        ],
    )
    .expect("valid");
    scene
}

/// Pixels of `scene` whose centre ray and its neighbours' first meet a receiver (the floor or a
/// part that is not a caster), away from the casters' silhouettes.
fn receiver_pixels(scene: &Scene) -> Vec<usize> {
    let (w, h) = (scene.render.width, scene.render.height);
    let prepared = Prepared::new(scene);
    let setup = prepared.caustics.as_ref().expect("caustics");
    let receiver = |x: u32, y: u32| {
        let ray = centre_ray(scene, x, y);
        match scene.geometry.trace(&ray) {
            Some(hit) => !setup.is_caster_instance(hit.instance),
            None => ray.dir.z < 0.0,
        }
    };
    let mut px = Vec::new();
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            if (0..9).all(|k| receiver(x + k % 3 - 1, y + k / 3 - 1)) {
                px.push((y * w + x) as usize);
            }
        }
    }
    px
}

#[test]
fn after_any_receiver_the_tracer_leaves_the_light_through_casters_to_the_map() {
    // The light reaches every receiver through the glass only. With an empty photon map the
    // camera paths keep only what the map does not bring, so every receiver pixel is black: not
    // only light through the glass seen at the first diffuse bounce, but also the caustic on the
    // wall seen from the floor (a second receiver). That one, left to the path tracer, came in
    // a few rare samples and was the sparkles around the bottle of the Final pair.
    let scene = enclosed_light_scene();
    let prepared = Prepared::new(&scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    for sample in 0..48 {
        let empty = PhotonMap::build(&prepared, sample, Vec::new(), 0);
        render_tile_photons(
            &scene,
            &prepared,
            Some(&empty),
            TileRect { x: 0, y: 0, w, h },
            sample,
            &mut film,
            Isa::detect(),
        );
    }
    let img = film.resolve();
    let px = receiver_pixels(&scene);
    assert!(px.len() >= 300, "{} receiver pixels", px.len());
    let lit: Vec<usize> = px
        .iter()
        .copied()
        .filter(|&i| img[i * 3 + 1] > 0.0)
        .collect();
    assert!(
        lit.is_empty(),
        "{} of {} receiver pixels lit: {:?}",
        lit.len(),
        px.len(),
        &lit[..lit.len().min(8)]
    );
    // The same paths with the photons do light them (the test means something).
    let with = render(&scene, 8, true).resolve();
    assert!(px.iter().filter(|&&i| with[i * 3 + 1] > 0.0).count() > px.len() / 2);
}

#[test]
fn every_receiver_gathers_the_caustics_once() {
    // The floor in front of the ball is lit mostly by the wall's caustic: the photon map brings
    // it at the second receiver of the camera paths, which must give the path tracer's light
    // there (twice as much would be counting it twice, a fraction of it losing it).
    let scene = enclosed_light_scene();
    let reference = render(&scene, 1024, false).resolve();
    let with = render(&scene, 192, true).resolve();
    let front = |p: Vec3| p.y > 45.0;
    let (r, n) = floor_mean(&scene, &reference, &front);
    let (c, _) = floor_mean(&scene, &with, &front);
    let (rw, cw) = {
        let px = receiver_pixels(&scene);
        let wall: Vec<usize> = px
            .into_iter()
            .filter(|&i| {
                let ray = centre_ray(&scene, i as u32 % 40, i as u32 / 40);
                scene.geometry.trace(&ray).is_some()
            })
            .collect();
        let mean = |img: &[f32]| {
            wall.iter().map(|&i| img[i * 3 + 1]).sum::<f32>() / wall.len().max(1) as f32
        };
        (mean(&reference), mean(&with))
    };
    eprintln!("floor in front of the ball ({n} px): reference {r:.4}, with caustics {c:.4}; wall: {rw:.4}, {cw:.4}");
    assert!(n >= 100 && r > 0.01, "{n} px, {r}");
    assert!((c / r - 1.0).abs() < 0.1, "floor {c} vs {r}");
    assert!((cw / rw - 1.0).abs() < 0.06, "wall {cw} vs {rw}");
}

#[test]
fn photons_inside_glass_carry_flux_not_radiance() {
    // A glass block (closed, 0..40 mm high) with a white card inside it at 20 mm, lit straight
    // from above: the photons cross the top face at normal incidence and land on the card. Flux
    // is conserved across the interface but for the Fresnel reflection, (1 - F0) = 0.96; radiance
    // would be 1/η² of that, which photons must not carry.
    let h = 50.0;
    let mut block = square(h, 40.0, true);
    block.extend(square(h, 0.0, false));
    for (a, b) in [
        (Vec3::new(-h, -h, 0.0), Vec3::new(h, -h, 0.0)),
        (Vec3::new(h, -h, 0.0), Vec3::new(h, h, 0.0)),
        (Vec3::new(h, h, 0.0), Vec3::new(-h, h, 0.0)),
        (Vec3::new(-h, h, 0.0), Vec3::new(-h, -h, 0.0)),
    ] {
        let up = Vec3::new(0.0, 0.0, 40.0);
        block.push([a, b, b + up]);
        block.push([a, b + up, a + up]);
    }
    let card = square(20.0, 20.0, true);
    let mut scene = sphere_scene(30.0, sun_above(1000.0), 40_000, (8, 8));
    scene.floor.mode = FloorMode::None;
    scene.materials = vec![glass(0.0), Material::default()];
    scene.geometry = Geometry::new(
        vec![mesh_of(&block, 0), mesh_of(&card, 1)],
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(1, Transform::IDENTITY, 1),
        ],
    )
    .expect("valid");
    let prepared = Prepared::new(&scene);
    let map = PhotonMap::trace(&scene, &prepared, 0, Isa::detect());
    let on_card: f32 = map
        .photons()
        .iter()
        .filter(|p| p.normal.z > 0.5 && (p.position.z - 20.0).abs() < 1.0e-2)
        .map(|p| p.power.g)
        .sum();
    // The card's top: 40 x 40 mm under 1000 W/m², times the transmittance of the top face. (Light
    // reflected inside the block back down onto the card is under 0.2 % of it.)
    let f0 = ((1.5f32 - 1.0) / 2.5).powi(2);
    let expected = 1000.0 * 40.0 * 40.0 * 1.0e-6 * (1.0 - f0);
    let ratio = on_card / expected;
    eprintln!("card flux {on_card} W against {expected} W: {ratio}");
    assert!((ratio - 1.0).abs() < 0.03, "{ratio}");
}

#[test]
fn the_shadow_catcher_shows_the_caustics_relative_to_the_open_floor() {
    // The interface's floor is a shadow catcher. A glass sphere's shadow on it must be lit by
    // the light that crosses the glass, as much (relative to the open floor) as a real white
    // floor is lit; without photons it is the dark shadow it always was.
    let light = Light {
        kind: LightKind::Disk,
        position: Vec3::new(0.0, -160.0, 200.0),
        direction: Vec3::new(0.0, 160.0, -170.0).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 30.0,
        power: 2.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let visible = sphere_scene(30.0, light, 8192, (40, 30));
    let mut catcher = visible.clone();
    catcher.floor.mode = FloorMode::ShadowCatcher;
    catcher.environment.background_mode = crate::scene::BACKGROUND_COLOR;
    catcher.environment.background_color = Rgb::splat(0.5);
    let centre = visible.lights[0].position;
    let (mut shadow, mut open) = (Vec::new(), Vec::new());
    for y in 0..30u32 {
        for x in 0..40u32 {
            let ray = centre_ray(&visible, x, y);
            if ray.dir.z >= 0.0 || visible.geometry.trace(&ray).is_some() {
                continue;
            }
            let p = ray.at(-ray.origin.z / ray.dir.z);
            let blocked = visible
                .geometry
                .trace(&Ray::new(
                    p + Vec3::new(0.0, 0.0, 1.0e-3),
                    (centre - p).normalize(),
                ))
                .is_some();
            (if blocked { &mut shadow } else { &mut open }).push((y * 40 + x) as usize);
        }
    }
    let mean = |img: &[f32], px: &[usize]| -> f32 {
        px.iter().map(|&i| img[i * 3 + 1]).sum::<f32>() / px.len() as f32
    };
    let ratio = |scene: &Scene, caustics: bool| {
        let img = render(scene, 96, caustics).resolve();
        mean(&img, &shadow) / mean(&img, &open)
    };
    let (real, shown, dark) = (
        ratio(&visible, true),
        ratio(&catcher, true),
        ratio(&catcher, false),
    );
    eprintln!("shadow / open floor: white floor {real:.3}, catcher {shown:.3}, catcher without photons {dark:.3}");
    assert!(
        dark < 0.2,
        "without photons the glass's shadow is dark: {dark}"
    );
    assert!(
        real > 0.5,
        "a clear glass sphere lets most light through: {real}"
    );
    assert!(
        (shown / real - 1.0).abs() < 0.12,
        "catcher {shown} vs floor {real}"
    );
}

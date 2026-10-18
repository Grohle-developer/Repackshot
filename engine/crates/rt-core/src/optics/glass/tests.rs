use super::*;

fn camera() -> Camera {
    Camera {
        position: Vec3::new(0.0, -1000.0, 100.0),
        target: Vec3::new(0.0, 0.0, 100.0),
        focal_mm: 50.0,
        fstop: 4.0,
        focus_dist: 1000.0,
        ..Camera::default()
    }
}

fn rainy() -> GlassParams {
    GlassParams {
        seed: 7,
        drop_coverage: 0.3,
        drop_size_mm: 2.0,
        drop_size_var: 0.6,
        ..GlassParams::default()
    }
}

/// A pane with only the drops `drops` (no merging, no scatter), at 25 mm, contact angle `deg`.
fn pane(drops: Vec<GlassDrop>, deg: f32) -> FrontGlass {
    let params = GlassParams {
        contact_angle_deg: deg,
        ..GlassParams::default()
    };
    FrontGlass::with_drops(params, &camera(), drops)
}

/// A ray of `camera()` from its position through the pane point `(x, y)` (local mm), or along
/// the view axis from the point `(x, y)` of the camera's plane when `parallel`.
fn ray_to(x: f32, y: f32, parallel: bool) -> Ray {
    let cam = camera();
    let (f, r, u) = cam.basis();
    if parallel {
        return Ray::new(cam.position + r * x + u * y, f);
    }
    let p = cam.position + f * SIMPLE_LENS_GAP_MM + r * x + u * y;
    Ray::new(cam.position, (p - cam.position).normalize())
}

#[test]
fn the_payload_round_trips_and_out_of_range_values_are_refused() {
    let p = GlassParams {
        flags: 9,
        distance_mm: 31.5,
        seed: 1234,
        drop_coverage: 0.4,
        drop_size_mm: 3.0,
        drop_size_var: 0.2,
        contact_angle_deg: 95.0,
        ior: 1.4,
        dust_coverage: 0.05,
        dust_size_mm: 0.4,
        dust_size_var: 0.3,
        dust_opacity: 0.8,
    };
    let bytes = p.encode();
    assert_eq!(bytes.len(), GLAS_BYTES);
    assert_eq!(GlassParams::decode(&bytes), Ok(p));
    let mut long = bytes.clone();
    long.extend_from_slice(&[0xff; 12]);
    assert_eq!(GlassParams::decode(&long), Ok(p));
    assert!(GlassParams::decode(&bytes[..GLAS_BYTES - 1]).is_err());
    let check = |f: &dyn Fn(&mut GlassParams)| {
        let mut q = p;
        f(&mut q);
        GlassParams::decode(&q.encode())
    };
    assert!(check(&|q| q.drop_coverage = 0.9).is_ok());
    assert!(check(&|q| q.drop_coverage = 0.95).is_err());
    assert!(check(&|q| q.contact_angle_deg = 4.0).is_err());
    assert!(check(&|q| q.contact_angle_deg = 176.0).is_err());
    assert!(check(&|q| q.ior = 0.9).is_err());
    assert!(check(&|q| q.distance_mm = -1.0).is_err());
    assert!(check(&|q| q.dust_opacity = 1.5).is_err());
    assert!(check(&|q| q.dust_coverage = 0.6).is_err());
    assert!(check(&|q| q.drop_size_mm = f32::NAN).is_err());
}

#[test]
fn two_drops_that_touch_become_one_of_their_summed_volume() {
    let (s, c) = fmath::sin_cos(60.0 * fmath::DEG_TO_RAD);
    let mut drops = vec![
        GlassDrop {
            x: 0.0,
            y: 0.0,
            a: 1.0,
        },
        GlassDrop {
            x: 1.8,
            y: 0.0,
            a: 0.9,
        },
        GlassDrop {
            x: 10.0,
            y: 0.0,
            a: 1.0,
        },
    ];
    let before = cap_volume(1.0, s, c) + cap_volume(0.9, s, c);
    merge_drops(&mut drops);
    assert_eq!(drops.len(), 2, "{drops:?}");
    let after = cap_volume(drops[0].a, s, c);
    assert!((after / before - 1.0).abs() < 1.0e-2, "{after} vs {before}");
    assert!((after / before - 1.0).abs() < 1.0e-5, "{after} vs {before}");
    // At their centre of mass, towards the larger one.
    let w = (1.0f32, 0.729f32);
    let x = (0.0 * w.0 + 1.8 * w.1) / (w.0 + w.1);
    assert!((drops[0].x - x).abs() < 1.0e-5 && drops[0].y == 0.0);
    assert_eq!(
        drops[1],
        GlassDrop {
            x: 10.0,
            y: 0.0,
            a: 1.0
        }
    );
    // A chain: the grown drop reaches the next one, which joins it on a later pass.
    let mut chain: Vec<GlassDrop> = (0..6)
        .map(|i| GlassDrop {
            x: 0.8 * i as f32,
            y: 0.0,
            a: 1.0,
        })
        .collect();
    let total: f32 = chain.iter().map(|d| cap_volume(d.a, s, c)).sum();
    merge_drops(&mut chain);
    assert_eq!(chain.len(), 1, "{chain:?}");
    assert!((cap_volume(chain[0].a, s, c) / total - 1.0).abs() < 1.0e-5);
    // Spaced wider, pairs merge and the grown drops stay apart: no two touch, nothing is lost.
    let mut pairs: Vec<GlassDrop> = (0..6)
        .map(|i| GlassDrop {
            x: 1.9 * i as f32,
            y: 0.0,
            a: 1.0,
        })
        .collect();
    merge_drops(&mut pairs);
    assert_eq!(pairs.len(), 3, "{pairs:?}");
    let left: f32 = pairs.iter().map(|d| cap_volume(d.a, s, c)).sum();
    assert!((left / total - 1.0).abs() < 1.0e-5);
    // Drops that do not touch stay as they are.
    let mut apart = vec![
        GlassDrop {
            x: 0.0,
            y: 0.0,
            a: 1.0,
        },
        GlassDrop {
            x: 2.01,
            y: 0.0,
            a: 1.0,
        },
    ];
    let copy = apart.clone();
    merge_drops(&mut apart);
    assert_eq!(apart, copy);
}

#[test]
fn a_rainy_pane_has_no_drops_that_touch_and_keeps_them_where_they_are() {
    let g = FrontGlass::new(rainy(), &camera());
    assert_eq!(g.distance(), SIMPLE_LENS_GAP_MM);
    let n = g.drops().len();
    assert!(n > 50, "{n}");
    for (i, a) in g.drops().iter().enumerate() {
        for b in &g.drops()[i + 1..] {
            let d2 = (a.x - b.x).powi(2) + (a.y - b.y).powi(2);
            assert!(d2 >= (a.a + b.a).powi(2), "{a:?} touches {b:?}");
        }
    }
    // Merging lowers the coverage asked for, never raises it.
    let cover = g.drop_cover();
    assert!(cover > 0.12 && cover < 0.3, "{cover}");
    // The same parameters give the same drops; another seed others.
    assert_eq!(FrontGlass::new(rainy(), &camera()), g);
    let other = FrontGlass::new(GlassParams { seed: 8, ..rainy() }, &camera());
    assert_ne!(other.drops(), g.drops());
    // A longer lens at a smaller aperture crosses less of the pane: the drops it sees are among
    // the shorter lens's, at the same places (the cells are the pane's, not the frame's), away from
    // the border. A viewport's image, wider than the frame, lays out the frame's drops.
    let tele = FrontGlass::new(
        rainy(),
        &Camera {
            focal_mm: 135.0,
            fstop: 16.0,
            ..camera()
        },
    );
    assert!(tele.half_extent() < g.half_extent());
    let viewport = FrontGlass::new(
        rainy(),
        &Camera {
            sensor_mm: 50.0,
            ..camera()
        },
    );
    assert_eq!(viewport.drops(), g.drops());
    let inner = |d: &&GlassDrop| {
        d.x.abs() < 0.5 * tele.half_extent() && d.y.abs() < 0.5 * tele.half_extent()
    };
    let a: Vec<_> = g.drops().iter().filter(inner).collect();
    let b: Vec<_> = tele.drops().iter().filter(inner).collect();
    assert!(!a.is_empty());
    // The same drops, up to the rounding of merging them in another order (the outer cells, which
    // only the wider pane has, shift the indices).
    assert_eq!(a.len(), b.len());
    for d in &a {
        assert!(
            b.iter().any(|e| (d.x - e.x).abs() < 1.0e-3
                && (d.y - e.y).abs() < 1.0e-3
                && (d.a - e.a).abs() < 1.0e-3),
            "{d:?} is not on the longer lens's pane"
        );
    }
    // A clean pane holds nothing, and lets every ray through untouched.
    let clean = FrontGlass::new(GlassParams::default(), &camera());
    assert!(clean.is_clear());
    for k in 0..50 {
        let ray = ray_to(k as f32 - 25.0, 0.3 * k as f32 - 7.0, false);
        assert_eq!(clean.cross(&camera(), &ray), Crossed::Unchanged);
    }
}

#[test]
fn a_ray_through_the_middle_of_a_drop_goes_straight_and_keeps_its_fresnel_share() {
    let g = pane(
        vec![GlassDrop {
            x: 0.0,
            y: 0.0,
            a: 2.0,
        }],
        60.0,
    );
    let ray = ray_to(0.0, 0.0, true);
    let Crossed::Through {
        ray: out,
        weight,
        bent,
    } = g.cross(&camera(), &ray)
    else {
        panic!("not through");
    };
    assert!(bent);
    let r0 = ((1.333f32 - 1.0) / (1.333 + 1.0)).powi(2);
    assert!((weight - (1.0 - r0)).abs() < 1.0e-5, "{weight}");
    assert!((out.dir - ray.dir).length() < 1.0e-5, "{:?}", out.dir);
    // It leaves at the top of the dome: R (1 − cos 60°) / sin 60° above the pane... the cap's height.
    let (f, _, _) = camera().basis();
    let height = (out.origin - camera().position).dot(f) - SIMPLE_LENS_GAP_MM;
    let cap = 2.0 * (1.0 - 0.5) / (0.75f32).sqrt();
    assert!((height - cap).abs() < 1.0e-3, "{height} vs {cap}");
    // Beside the drop nothing changes.
    assert_eq!(
        g.cross(&camera(), &ray_to(5.0, 0.0, true)),
        Crossed::Unchanged
    );
}

#[test]
fn a_drop_is_a_lens_that_brings_parallel_rays_to_its_focus() {
    // A plano-convex lens of radius R and index n focuses parallel light R / (n − 1) beyond its
    // vertex (thin, paraxial): the rays a little off the axis cross it near there.
    let (a, deg) = (2.0f32, 40.0f32);
    let g = pane(vec![GlassDrop { x: 0.0, y: 0.0, a }], deg);
    let radius = a / (deg * fmath::DEG_TO_RAD).sin();
    let focus = radius / (1.333 - 1.0);
    let cam = camera();
    let (f, r, _) = cam.basis();
    for h in [0.05f32, 0.1, 0.2] {
        let Crossed::Through { ray, .. } = g.cross(&cam, &ray_to(h, 0.0, true)) else {
            panic!("not through");
        };
        // Where it crosses the axis, from the pane.
        let x = (ray.origin - cam.position).dot(r);
        let dx = ray.dir.dot(r);
        assert!(dx < 0.0, "it bends towards the axis");
        let t = -x / dx;
        let z = (ray.at(t) - cam.position).dot(f) - SIMPLE_LENS_GAP_MM;
        assert!((z / focus - 1.0).abs() < 0.08, "h {h}: {z} vs {focus}");
    }
}

#[test]
fn the_rim_of_a_steep_drop_sends_light_back_and_motes_stop_it() {
    // A hemisphere (90°): near its rim a ray parallel to the axis meets the dome from inside past
    // the critical angle (sin > 1 / 1.333 beyond 0.75 a), reflects totally round the dome and
    // leaves back through the base towards the camera: it brings nothing. Near the middle it goes
    // through.
    let g = pane(
        vec![GlassDrop {
            x: 0.0,
            y: 0.0,
            a: 2.0,
        }],
        90.0,
    );
    let blocked = (0..20)
        .filter(|k| {
            let x = 1.6 + 0.019 * *k as f32;
            g.cross(&camera(), &ray_to(x, 0.0, true)) == Crossed::Blocked
        })
        .count();
    assert!(blocked >= 15, "a drop has a dark rim: {blocked} of 20");
    for k in 0..20 {
        let x = 0.07 * k as f32;
        assert!(
            matches!(
                g.cross(&camera(), &ray_to(x, 0.0, true)),
                Crossed::Through { .. }
            ),
            "{x}"
        );
    }
    // Every ray it lets through weighs at most one.
    for k in 0..200 {
        let x = -2.5 + 0.025 * k as f32;
        if let Crossed::Through { weight, .. } = g.cross(&camera(), &ray_to(x, 0.3, true)) {
            assert!((0.0..=1.0).contains(&weight));
        }
    }
    // Dust: an opaque mote stops what crosses it, a half one halves it.
    let mut dusty = FrontGlass::new(
        GlassParams {
            dust_coverage: 0.2,
            dust_size_mm: 1.0,
            dust_opacity: 1.0,
            ..GlassParams::default()
        },
        &camera(),
    );
    let m = dusty.motes()[0];
    let through = ray_to(m.x, m.y, false);
    assert_eq!(dusty.cross(&camera(), &through), Crossed::Blocked);
    dusty.params.dust_opacity = 0.5;
    match dusty.cross(&camera(), &through) {
        Crossed::Through { weight, bent, ray } => {
            assert!(!bent && ray == through);
            assert!(weight == 0.5 || weight == 0.25, "{weight}");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_traced_lens_keeps_the_pane_in_front_of_its_front_vertex() {
    let mut cam = camera();
    let g = FrontGlass::new(
        GlassParams {
            distance_mm: 3.0,
            ..rainy()
        },
        &cam,
    );
    assert_eq!(g.distance(), 3.0, "a simple lens: where it is asked");
    cam.ortho = true;
    cam.ortho_width = 400.0;
    let ortho = FrontGlass::new(rainy(), &cam);
    assert!((ortho.half_extent() - 220.0).abs() < 1.0e-3);
}

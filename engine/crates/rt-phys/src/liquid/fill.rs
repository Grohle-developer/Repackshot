//! Filling a part with particles (S7, *Convert to liquid*): the points of a close packing of the
//! particle spacing (the face-centred cubic lattice of [`super::surface::fcc_cell`], four
//! particles per cell, so each stands for a cube of the spacing) that are inside the part's mesh,
//! by ray parity. For each row of the lattice
//! along an axis, the crossings of a ray along that row with the triangles are counted: a point
//! with an odd number of crossings before it is inside. Each point is tested along the three axes
//! and is inside when two of them say so, so a mesh with a small hole or a ray grazing an edge
//! does not leave a stripe of the lattice empty or full.
//!
//! The lattice is the cubic grid of half the cell, keeping the points whose indices add up to an
//! even number; it is centred in the mesh's box, a quarter of a cell in from its sides.

use rt_core::math::Vec3;

/// Most particles a fill makes (past it the spacing grows, never a refusal).
pub const MAX_PARTICLES: usize = 200_000;

/// The world-space triangles of a mesh.
fn triangles(positions: &[Vec3], indices: &[u32]) -> Vec<[Vec3; 3]> {
    indices
        .chunks_exact(3)
        .filter_map(|t| {
            let v = |i: u32| positions.get(i as usize).copied();
            Some([v(t[0])?, v(t[1])?, v(t[2])?])
        })
        .filter(|t| t.iter().all(|p| p.is_finite()))
        .collect()
}

#[inline]
fn axis(v: Vec3, a: usize) -> f32 {
    match a {
        0 => v.x,
        1 => v.y,
        _ => v.z,
    }
}

/// Where the line `{(u, w) fixed}` along `axis` crosses the triangle, if it does: the
/// coordinate along the axis. The point-in-triangle test on the other two coordinates is by the
/// signs of the three edge functions, in `f64` (the products of `f32` differences are exact
/// there, so the signs are exact), the triangle first turned counter-clockwise; a line exactly
/// on an edge counts for the triangle on whose left the edge runs down (or, level, leftwards),
/// so of two triangles that share an edge exactly one counts it, as a rasteriser's top-left
/// rule does.
fn crossing(t: &[Vec3; 3], ax: usize, u: f32, w: f32) -> Option<f32> {
    let (iu, iw) = ((ax + 1) % 3, (ax + 2) % 3);
    let p = |k: usize| {
        (
            f64::from(axis(t[k], iu)),
            f64::from(axis(t[k], iw)),
            axis(t[k], ax),
        )
    };
    let (a, mut b, mut c) = (p(0), p(1), p(2));
    let (u, w) = (f64::from(u), f64::from(w));
    let area = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    if area == 0.0 {
        return None;
    }
    if area < 0.0 {
        std::mem::swap(&mut b, &mut c);
    }
    let edge = |p: (f64, f64, f32), q: (f64, f64, f32)| {
        let e = (q.0 - p.0) * (w - p.1) - (q.1 - p.1) * (u - p.0);
        let (du, dw) = (q.0 - p.0, q.1 - p.1);
        let owns = dw < 0.0 || (dw == 0.0 && du < 0.0);
        (e, e > 0.0 || (e == 0.0 && owns))
    };
    let ((e0, in0), (e1, in1), (e2, in2)) = (edge(a, b), edge(b, c), edge(c, a));
    if !(in0 && in1 && in2) {
        return None;
    }
    let sum = e0 + e1 + e2;
    // Barycentric weights: e1 is opposite a, e2 opposite b, e0 opposite c.
    Some(((e1 * f64::from(a.2) + e2 * f64::from(b.2) + e0 * f64::from(c.2)) / sum) as f32)
}

/// The points of the lattice of `spacing` inside the closed mesh, in lattice order (x fastest,
/// then y, then z), and the spacing used (larger than asked when the part would need more than
/// [`MAX_PARTICLES`]).
pub fn fill(positions: &[Vec3], indices: &[u32], spacing: f32) -> (Vec<Vec3>, f32) {
    let tris = triangles(positions, indices);
    if tris.is_empty() || !(spacing > 0.0 && spacing.is_finite()) {
        return (Vec::new(), spacing);
    }
    let mut lo = tris[0][0];
    let mut hi = lo;
    for t in &tris {
        for p in t {
            lo = lo.min(*p);
            hi = hi.max(*p);
        }
    }
    let size = hi - lo;
    let mut spacing = spacing;
    let mut s;
    let mut dims;
    loop {
        // The grid of half the close packing's cell; every other point is a particle.
        s = 0.5 * super::surface::fcc_cell(spacing);
        dims = [
            ((size.x / s) as usize).max(1),
            ((size.y / s) as usize).max(1),
            ((size.z / s) as usize).max(1),
        ];
        if dims[0].saturating_mul(dims[1]).saturating_mul(dims[2]) / 2 <= MAX_PARTICLES {
            break;
        }
        spacing *= 1.1;
    }
    // Centre the lattice in the box: what is left over is split on both sides.
    let used = Vec3::new(dims[0] as f32, dims[1] as f32, dims[2] as f32) * s;
    let start = lo + (size - used) * 0.5 + Vec3::splat(0.5 * s);
    let at = |i: usize, k: usize| axis(start, k) + i as f32 * s;
    let count = dims[0] * dims[1] * dims[2];
    let mut votes = vec![0u8; count];
    let mut crossings: Vec<f32> = Vec::new();
    for ax in 0..3 {
        let (iu, iw) = ((ax + 1) % 3, (ax + 2) % 3);
        // The triangles that each row may cross, by the rows their box covers.
        let mut rows: Vec<Vec<u32>> = vec![Vec::new(); dims[iu] * dims[iw]];
        for (k, t) in tris.iter().enumerate() {
            let (mut u0, mut u1, mut w0, mut w1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
            for p in t {
                u0 = u0.min(axis(*p, iu));
                u1 = u1.max(axis(*p, iu));
                w0 = w0.min(axis(*p, iw));
                w1 = w1.max(axis(*p, iw));
            }
            let range = |a: f32, b: f32, k: usize, n: usize| {
                let first = ((a - axis(start, k)) / s).ceil().max(0.0) as usize;
                let last = ((b - axis(start, k)) / s).floor();
                if last < 0.0 {
                    return (1, 0);
                }
                (first, (last as usize).min(n - 1))
            };
            let (ua, ub) = range(u0, u1, iu, dims[iu]);
            let (wa, wb) = range(w0, w1, iw, dims[iw]);
            for wi in wa..=wb.min(dims[iw].saturating_sub(1)) {
                if wa > wb {
                    break;
                }
                for ui in ua..=ub {
                    if ua > ub {
                        break;
                    }
                    rows[ui + dims[iu] * wi].push(k as u32);
                }
            }
        }
        for wi in 0..dims[iw] {
            for ui in 0..dims[iu] {
                let list = &rows[ui + dims[iu] * wi];
                if list.is_empty() {
                    continue;
                }
                let (u, w) = (at(ui, iu), at(wi, iw));
                crossings.clear();
                crossings.extend(
                    list.iter()
                        .filter_map(|&k| crossing(&tris[k as usize], ax, u, w)),
                );
                crossings.sort_by(f32::total_cmp);
                let mut c = 0usize;
                for i in 0..dims[ax] {
                    let x = at(i, ax);
                    while c < crossings.len() && crossings[c] < x {
                        c += 1;
                    }
                    if c % 2 == 1 {
                        let mut idx = [0usize; 3];
                        idx[ax] = i;
                        idx[iu] = ui;
                        idx[iw] = wi;
                        votes[idx[0] + dims[0] * (idx[1] + dims[1] * idx[2])] += 1;
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    for z in 0..dims[2] {
        for y in 0..dims[1] {
            for x in 0..dims[0] {
                if (x + y + z) % 2 == 0 && votes[x + dims[0] * (y + dims[1] * z)] >= 2 {
                    out.push(Vec3::new(at(x, 0), at(y, 1), at(z, 2)));
                }
            }
        }
    }
    // Each particle stands for an equal share of the part's volume: the spacing becomes the cube
    // root of that share (a little more or less than the lattice's, where the lattice did not fit
    // the part exactly), unless the mesh's volume is not a closed solid's.
    let volume = super::surface::mesh_volume(positions, indices);
    let lattice = out.len() as f64 * f64::from(spacing).powi(3);
    if !out.is_empty() && volume > 0.8 * lattice && volume < 1.25 * lattice {
        spacing = cube_root(volume / out.len() as f64) as f32;
    }
    (out, spacing)
}

/// `∛x` for `x > 0` by Newton's method from a fixed start (only `+ − × ÷`, so the same bits
/// everywhere).
pub fn cube_root(x: f64) -> f64 {
    if !(x > 0.0 && x.is_finite()) {
        return 0.0;
    }
    // A start within a factor of two: 2^(e/3) from the exponent.
    let e = ((x.to_bits() >> 52) & 0x7ff) as i64 - 1023;
    let mut r = f64::from_bits(((e / 3 + 1023) as u64) << 52);
    for _ in 0..60 {
        let next = (2.0 * r + x / (r * r)) / 3.0;
        if next == r {
            break;
        }
        r = next;
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::example::{box_mesh, sphere_mesh};

    #[test]
    fn a_box_holds_its_volume_in_particles() {
        let m = box_mesh(Vec3::new(50.0, 50.0, 50.0));
        let (pts, s) = fill(&m.positions, &m.indices, 6.25);
        // The particles stand for the box's litre exactly, each for a little more than 6.25³.
        let held = pts.len() as f64 * f64::from(s).powi(3);
        assert!((held / 1.0e6 - 1.0).abs() < 1.0e-5, "{held}");
        assert!((s / 6.25 - 1.0).abs() < 0.02, "{s}");
        assert!(pts
            .iter()
            .all(|p| p.x.abs() < 50.0 && p.y.abs() < 50.0 && p.z.abs() < 50.0));
        // Each point's nearest neighbours are the close packing's: 12 at 1.12 spacings (of the
        // lattice's, 6.25 mm; `s` is the volume each stands for). The point nearest the box's
        // centre, all of whose neighbours are inside.
        let p0 = *pts
            .iter()
            .min_by(|a, b| a.length().total_cmp(&b.length()))
            .expect("points");
        let near = pts
            .iter()
            .filter(|q| ((**q - p0).length() / 6.25 - 1.1225).abs() < 0.01)
            .count();
        assert_eq!(near, 12);
    }

    #[test]
    fn a_sphere_holds_its_volume_and_nothing_outside() {
        let m = sphere_mesh(40.0, 32, 64);
        let (pts, s) = fill(&m.positions, &m.indices, 3.0);
        let volume = pts.len() as f64 * 27.0;
        // The mesh's own volume (a polyhedron inside the sphere).
        let want = crate::liquid::surface::mesh_volume(&m.positions, &m.indices);
        assert!((volume / want - 1.0).abs() < 0.02, "{volume} vs {want}");
        assert!((f64::from(s).powi(3) * pts.len() as f64 / want - 1.0).abs() < 1.0e-5);
        assert!(pts.iter().all(|p| p.length() < 40.0));
    }

    #[test]
    fn cube_roots_are_exact_enough() {
        for x in [1.0e-3f64, 0.5, 1.0, 27.0, 578.7, 1.0e6, 3.3e9] {
            let r = cube_root(x);
            assert!((r * r * r / x - 1.0).abs() < 1.0e-14, "{x}");
        }
    }

    #[test]
    fn one_axis_alone_fills_nothing() {
        // A single triangle: the rays across it find one crossing and say inside, the other
        // two axes run along its plane and see nothing, so no point has two votes.
        let m = box_mesh(Vec3::new(10.0, 10.0, 10.0));
        let (pts, _) = fill(&m.positions, &m.indices[..3], 2.0);
        assert!(pts.is_empty());
    }
}

//! Straight rays through the shells: the segments a ray crosses, and its columns.
//!
//! A ray `p + t d` (`|d| = 1`, `p` measured from the Earth's centre) meets the sphere of radius
//! `r` where `t = -p·d ± sqrt(r² - b²)`, `b² = |p|² - (p·d)²` its squared distance of closest
//! approach. Going down it crosses the boundaries below it at the smaller root until it hits the
//! ground or turns round inside a shell; then it climbs through the boundaries above at the larger
//! root and leaves at the top. The roots are written in the forms that do not cancel.

use crate::atmosphere::{Atmosphere, SHELLS};

/// The part of a ray inside one shell, `t0..t1` along it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    /// Index of the shell.
    pub shell: usize,
    /// Where the ray enters the shell.
    pub t0: f64,
    /// Where it leaves.
    pub t1: f64,
}

/// `a · b`.
#[inline]
pub fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// `p + t d`.
#[inline]
pub fn along(p: [f64; 3], d: [f64; 3], t: f64) -> [f64; 3] {
    [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]]
}

/// `|a|`.
#[inline]
pub fn length(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}

/// The shell that holds radius `r` (clamped to the atmosphere).
pub fn shell_of(radii: &[f64], r: f64) -> usize {
    // radii[i] <= r < radii[i + 1]
    let (mut lo, mut hi) = (0usize, SHELLS);
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if r >= radii[mid] {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Fills `out` with the segments of the ray from `p` along `d` until it leaves the atmosphere
/// or hits the ground; returns true when it hits the ground (at `out.last().t1`).
pub fn traverse(atm: &Atmosphere, p: [f64; 3], d: [f64; 3], out: &mut Vec<Segment>) -> bool {
    out.clear();
    let radii = &atm.radii;
    let r0 = length(p);
    let pd = dot(p, d);
    let mut i = shell_of(radii, r0);
    let mut t_prev = 0.0;
    if pd < 0.0 {
        loop {
            let ri = radii[i];
            let disc = pd * pd + (ri - r0) * (ri + r0); // r_i² - b²
            if disc < 0.0 {
                break; // turns round inside shell i
            }
            let t = ((r0 - ri) * (r0 + ri) / (-pd + disc.sqrt())).max(t_prev);
            out.push(Segment {
                shell: i,
                t0: t_prev,
                t1: t,
            });
            t_prev = t;
            if i == 0 {
                return true;
            }
            i -= 1;
        }
    }
    for shell in i..SHELLS {
        let ro = radii[shell + 1];
        let disc = (pd * pd + (ro - r0) * (ro + r0)).max(0.0);
        let t = if pd < 0.0 {
            -pd + disc.sqrt()
        } else {
            (ro - r0) * (ro + r0) / (pd + disc.sqrt())
        }
        .max(t_prev);
        out.push(Segment {
            shell,
            t0: t_prev,
            t1: t,
        });
        t_prev = t;
    }
    false
}

/// The columns (air molecules, aerosol, ozone) of `segments` up to `t` along the ray.
pub fn columns(atm: &Atmosphere, segments: &[Segment], t: f64) -> [f64; 3] {
    let mut c = [0.0; 3];
    for s in segments {
        if s.t0 >= t {
            break;
        }
        let l = s.t1.min(t) - s.t0;
        let sh = &atm.shells[s.shell];
        c[0] += l * sh.air;
        c[1] += l * sh.aerosol;
        c[2] += l * sh.ozone;
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atmosphere::{EARTH_RADIUS, TOP_ALTITUDE};

    #[test]
    fn vertical_and_slant_rays_cross_the_right_lengths() {
        let atm = Atmosphere::new(2.0);
        let mut segs = Vec::new();
        // Straight up from the ground: the segments tile [0, top].
        let ground = [0.0, 0.0, EARTH_RADIUS];
        assert!(!traverse(&atm, ground, [0.0, 0.0, 1.0], &mut segs));
        assert_eq!(segs.len(), SHELLS);
        assert!((segs.last().unwrap().t1 - TOP_ALTITUDE).abs() < 1.0e-6);
        for (i, s) in segs.iter().enumerate() {
            assert_eq!(s.shell, i);
            assert!((s.t1 - s.t0 - (atm.radii[i + 1] - atm.radii[i])).abs() < 1.0e-6);
        }
        // Straight down from 10 km: it hits the ground after 10 km.
        let high = [0.0, 0.0, EARTH_RADIUS + 10_000.0];
        assert!(traverse(&atm, high, [0.0, 0.0, -1.0], &mut segs));
        assert!((segs.last().unwrap().t1 - 10_000.0).abs() < 1.0e-6);
        // Horizontal from 10 km: it misses the ground, dips no lower than 10 km and leaves the
        // top at the chord length.
        assert!(!traverse(&atm, high, [1.0, 0.0, 0.0], &mut segs));
        let (r0, rt) = (EARTH_RADIUS + 10_000.0, EARTH_RADIUS + TOP_ALTITUDE);
        let want = (rt * rt - r0 * r0).sqrt();
        assert!((segs.last().unwrap().t1 - want).abs() < 1.0e-4);
        // Slightly downwards from 10 km: it turns round in a lower shell.
        let d = [0.999, 0.0, -(1.0f64 - 0.999 * 0.999).sqrt()];
        assert!(!traverse(&atm, high, d, &mut segs));
        let lowest = segs.iter().map(|s| s.shell).min().unwrap();
        assert!(lowest < shell_of(&atm.radii, r0));
        for w in segs.windows(2) {
            assert!(w[0].t1 == w[1].t0 && w[1].t1 >= w[1].t0);
        }
        // The columns of a vertical ray are the shells' column densities.
        assert!(!traverse(&atm, ground, [0.0, 0.0, 1.0], &mut segs));
        let c = columns(&atm, &segs, f64::INFINITY);
        let air: f64 = atm
            .shells
            .iter()
            .zip(atm.radii.windows(2))
            .map(|(s, r)| s.air * (r[1] - r[0]))
            .sum();
        assert!((c[0] / air - 1.0).abs() < 1.0e-9);
        assert!((c[1] - 1.0).abs() < 1.0e-9);
    }
}

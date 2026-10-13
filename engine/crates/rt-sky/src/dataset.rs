//! The simulated skies the table is fitted to and checked against: the recipe, the direction
//! grids, the Sun elevations, and their simulation (cached on disk between runs).

use crate::atmosphere::Atmosphere;
use crate::dmath;
use crate::fit::{Sample, Slice};
use crate::model::{elevation_parameter, View, ALBEDOS, CHANNELS, TURBIDITIES};
use crate::simulate::{parallel_map, sky_view, sun_direction, view_direction};
use crate::spectrum::{bands_to_rgb, cmf_weights, BANDS};

use std::path::Path;
use std::time::Instant;

/// What the table is made from: change any of it and the table changes.
#[derive(Clone, Debug, PartialEq)]
pub struct Recipe {
    /// Seed of every random stream.
    pub seed: u64,
    /// Multiple-scattering paths per direction of the fitted skies.
    pub paths: usize,
    /// Number of simulated Sun elevations: `x = i / (n - 1)`, elevation `90° x³`.
    pub elevations: usize,
}

/// The recipe of the committed table.
pub const RECIPE: Recipe = Recipe {
    seed: 0x0e5c_5c1e,
    paths: 8 * BANDS,
    elevations: 16,
};

/// A set of view directions over the upper hemisphere, the Sun at azimuth 0 (the sky is
/// symmetric, so azimuths run from 0 to 180 degrees), with solid-angle weights.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    /// `(zenith angle, azimuth)` in radians.
    pub angles: Vec<(f64, f64)>,
    /// Unit vectors.
    pub views: Vec<[f64; 3]>,
    /// Solid angle of each direction's cell (the half hemisphere sums to π).
    pub weights: Vec<f64>,
}

impl Grid {
    /// Rings at `ring_edges` (degrees of zenith angle, cells between consecutive edges, the
    /// direction at the middle) times `azimuths` (degrees, cells between midpoints).
    pub fn new(ring_edges: &[f64], azimuths: &[f64]) -> Grid {
        let mut g = Grid {
            angles: Vec::new(),
            views: Vec::new(),
            weights: Vec::new(),
        };
        for w in ring_edges.windows(2) {
            let (t0, t1) = (w[0] * dmath::DEG, w[1] * dmath::DEG);
            let theta = 0.5 * (t0 + t1);
            let band = dmath::cos(t0) - dmath::cos(t1);
            for (j, &a) in azimuths.iter().enumerate() {
                let lo = if j == 0 {
                    a
                } else {
                    0.5 * (azimuths[j - 1] + a)
                };
                let hi = if j + 1 == azimuths.len() {
                    a
                } else {
                    0.5 * (a + azimuths[j + 1])
                };
                let phi = a * dmath::DEG;
                g.angles.push((theta, phi));
                g.views.push(view_direction(theta, phi));
                g.weights.push(band * (hi - lo) * dmath::DEG);
            }
        }
        g
    }

    /// The grid the table is fitted on: 3-degree rings to 84 degrees, then 1.5-degree ones to
    /// the horizon, times 24 azimuths, closer together near the Sun.
    pub fn fit() -> Grid {
        let mut edges: Vec<f64> = (0..=28).map(|i| 3.0 * i as f64).collect();
        edges.extend([85.5, 87.0, 88.5, 90.0]);
        let azimuths = [
            0.0, 2.0, 4.0, 6.0, 8.0, 10.0, 13.0, 16.0, 20.0, 25.0, 30.0, 40.0, 50.0, 60.0, 70.0,
            80.0, 90.0, 100.0, 110.0, 120.0, 135.0, 150.0, 165.0, 180.0,
        ];
        Grid::new(&edges, &azimuths)
    }

    /// The coarser grid of the low-noise validation skies: 9-degree rings and a last one at the
    /// horizon, times 13 azimuths.
    pub fn validation() -> Grid {
        let mut edges: Vec<f64> = (0..=9).map(|i| 9.0 * i as f64).collect();
        edges[9] = 81.0;
        edges.extend([87.0, 90.0]);
        let azimuths: Vec<f64> = (0..=12).map(|j| 15.0 * j as f64).collect();
        Grid::new(&edges, &azimuths)
    }

    /// Number of directions.
    pub fn len(&self) -> usize {
        self.views.len()
    }

    /// True when the grid has no directions.
    pub fn is_empty(&self) -> bool {
        self.views.is_empty()
    }
}

/// The simulated Sun elevations of the fit, degrees: `90° (i / (n - 1))³`.
pub fn fit_elevations(n: usize) -> Vec<f64> {
    (0..n)
        .map(|i| {
            let x = i as f64 / (n - 1) as f64;
            90.0 * x * x * x
        })
        .collect()
}

/// One simulated sky: per direction, the linear Rec. 709 radiance over a black ground, a white
/// ground and a ground of albedo [`crate::simulate::GREY_ALBEDO`].
#[derive(Clone, Debug, PartialEq)]
pub struct Sky {
    /// Linke turbidity.
    pub turbidity: f64,
    /// Sun elevation, degrees.
    pub elevation_deg: f64,
    /// `[black, white, grey]` RGB per direction.
    pub rgb: Vec<[[f64; 3]; 3]>,
}

/// Simulates the skies `configs` (turbidity, elevation) over `grid` with `paths` paths per
/// direction; every (sky, direction) is one work item for the threads.
pub fn simulate(
    configs: &[(f64, f64)],
    grid: &Grid,
    paths: usize,
    seed: u64,
    threads: usize,
    label: &str,
) -> Vec<Sky> {
    let w = cmf_weights();
    let start = Instant::now();
    let atmospheres: Vec<Atmosphere> = configs.iter().map(|&(t, _)| Atmosphere::new(t)).collect();
    let n = grid.len();
    let done = std::sync::atomic::AtomicUsize::new(0);
    let items = parallel_map(configs.len() * n, threads, |i| {
        let (c, v) = (i / n, i % n);
        let (t, el) = configs[c];
        let keys = [seed, t.to_bits(), el.to_bits(), v as u64];
        let r = sky_view(&atmospheres[c], el, grid.views[v], paths, &keys);
        let k = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        if k.is_multiple_of((n * configs.len() / 20).max(1)) {
            eprintln!(
                "  {label}: {:.0} % after {:.0} s",
                100.0 * k as f64 / (n * configs.len()) as f64,
                start.elapsed().as_secs_f64()
            );
        }
        r
    });
    configs
        .iter()
        .enumerate()
        .map(|(c, &(turbidity, elevation_deg))| Sky {
            turbidity,
            elevation_deg,
            rgb: items[c * n..(c + 1) * n]
                .iter()
                .map(|r| {
                    [
                        bands_to_rgb(&r.black, &w),
                        bands_to_rgb(&r.white, &w),
                        bands_to_rgb(&r.grey, &w),
                    ]
                })
                .collect(),
        })
        .collect()
}

/// Writes skies to a cache file: a text header naming `key`, then little-endian `f64`s.
pub fn save(path: &Path, key: &str, skies: &[Sky]) -> std::io::Result<()> {
    let mut bytes = format!("rt-sky cache\n{key}\n{}\n", skies.len()).into_bytes();
    for s in skies {
        bytes.extend_from_slice(&s.turbidity.to_le_bytes());
        bytes.extend_from_slice(&s.elevation_deg.to_le_bytes());
        bytes.extend_from_slice(&(s.rgb.len() as u64).to_le_bytes());
        for d in &s.rgb {
            for g in d {
                for v in g {
                    bytes.extend_from_slice(&v.to_le_bytes());
                }
            }
        }
    }
    std::fs::write(path, bytes)
}

/// Reads a cache file written by [`save`] with the same `key`; `None` otherwise.
pub fn load(path: &Path, key: &str) -> Option<Vec<Sky>> {
    let bytes = std::fs::read(path).ok()?;
    let mut lines = 0;
    let mut pos = 0;
    while lines < 3 {
        pos += bytes[pos..].iter().position(|&b| b == b'\n')? + 1;
        lines += 1;
    }
    let header = std::str::from_utf8(&bytes[..pos]).ok()?;
    let mut h = header.lines();
    if h.next()? != "rt-sky cache" || h.next()? != key {
        return None;
    }
    let count: usize = h.next()?.parse().ok()?;
    let mut rd = bytes[pos..].chunks_exact(8).map(|c| {
        let mut b = [0u8; 8];
        b.copy_from_slice(c);
        b
    });
    let mut skies = Vec::with_capacity(count);
    for _ in 0..count {
        let turbidity = f64::from_le_bytes(rd.next()?);
        let elevation_deg = f64::from_le_bytes(rd.next()?);
        let n = u64::from_le_bytes(rd.next()?) as usize;
        let mut rgb = Vec::with_capacity(n);
        for _ in 0..n {
            let mut d = [[0.0; 3]; 3];
            for g in &mut d {
                for v in g.iter_mut() {
                    *v = f64::from_le_bytes(rd.next()?);
                }
            }
            rgb.push(d);
        }
        skies.push(Sky {
            turbidity,
            elevation_deg,
            rgb,
        });
    }
    Some(skies)
}

/// The skies of the fit: every integer turbidity at every elevation of `recipe`.
pub fn fit_configs(recipe: &Recipe) -> Vec<(f64, f64)> {
    let elevations = fit_elevations(recipe.elevations);
    (1..=TURBIDITIES)
        .flat_map(|t| elevations.iter().map(move |&e| (t as f64, e)))
        .collect()
}

/// The slices of one knot (turbidity index, albedo index, channel) from the fit's skies, in
/// increasing elevation. Directions whose simulated value is not positive are left out.
pub fn slices(
    skies: &[Sky],
    grid: &Grid,
    turbidity: usize,
    albedo: usize,
    channel: usize,
) -> Vec<Slice> {
    assert!(albedo < ALBEDOS && channel < CHANNELS);
    let mut out: Vec<Slice> = skies
        .iter()
        .filter(|s| s.turbidity == (turbidity + 1) as f64)
        .map(|s| {
            let sun = sun_direction(s.elevation_deg);
            let samples = grid
                .views
                .iter()
                .zip(&grid.weights)
                .zip(&s.rgb)
                .filter(|(_, rgb)| rgb[albedo][channel] > 0.0)
                .map(|((&v, &weight), rgb)| Sample {
                    view: View::new(v, sun),
                    weight,
                    value: rgb[albedo][channel],
                })
                .collect();
            Slice {
                elevation_deg: s.elevation_deg,
                x: elevation_parameter(s.elevation_deg),
                samples,
            }
        })
        .collect();
    out.sort_by(|a, b| a.x.total_cmp(&b.x));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grids_cover_the_half_hemisphere() {
        for g in [Grid::fit(), Grid::validation()] {
            let total: f64 = g.weights.iter().sum();
            assert!((total - dmath::PI).abs() < 1.0e-9, "{total}");
            assert!(g.views.iter().all(|v| v[2] > 0.0));
        }
        assert_eq!(Grid::fit().len(), 32 * 24);
        let e = fit_elevations(16);
        assert_eq!((e[0], e[15]), (0.0, 90.0));
    }

    #[test]
    fn the_cache_round_trips_and_checks_its_key() {
        let skies = vec![Sky {
            turbidity: 2.0,
            elevation_deg: 10.0,
            rgb: vec![[[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.5]]; 3],
        }];
        let dir = std::env::temp_dir().join(format!("rt-sky-cache-{}", std::process::id()));
        save(&dir, "abc", &skies).unwrap();
        assert_eq!(load(&dir, "abc"), Some(skies));
        assert_eq!(load(&dir, "abd"), None);
        let _ = std::fs::remove_file(&dir);
    }
}

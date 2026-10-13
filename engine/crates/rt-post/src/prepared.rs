//! What every guard step needs from the job, the engine image and the passes, computed once per
//! attempt: the display image, the material regions and which of them each control may touch.

use crate::image::{Display, LinearImage, Passes};
use crate::job::{fraction, Job};
use rt_core::passes::FLOOR_ID;
use std::collections::BTreeSet;

/// Standard deviation of the blur below which the checks see the high band, pixels.
pub(crate) const SIGMA_HIGH: f32 = 1.5;
/// Standard deviation of the blur below which the model's change is too fine to be wear: the mid
/// band that wear may bring starts here, well above the high band the checks protect.
pub(crate) const SIGMA_WEAR: f32 = 3.0;

/// Region index of background pixels.
pub(crate) const BACKGROUND: u32 = u32::MAX;

/// The name of the studio floor's region when the job's table does not name it.
pub const FLOOR_NAME: &str = "Floor";

/// One material region present in the image.
#[derive(Clone, Debug)]
pub(crate) struct Region {
    pub id: u32,
    pub name: String,
    pub allows_wear: bool,
    pub locked: bool,
}

/// The controls as fractions in `[0, 1]`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Aspects {
    pub light: f32,
    pub bounce: f32,
    pub style: f32,
    pub wear: f32,
}

impl Aspects {
    pub fn of(job: &Job) -> Aspects {
        let s = &job.settings;
        Aspects {
            light: fraction(s.light),
            bounce: fraction(s.bounce),
            style: fraction(s.style_strength),
            wear: fraction(s.wear),
        }
    }
}

/// The caps of one attempt: the most each aspect may change, natural log. `scale` is the
/// attempt's strength over `MAX_STRENGTH` (Intervention, lowered by every retry).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Caps {
    pub light: f32,
    pub bounce: f32,
    pub style: f32,
    pub wear: f32,
}

impl Caps {
    pub fn of(job: &Job, scale: f32) -> Caps {
        let a = Aspects::of(job);
        let t = &job.tolerances;
        Caps {
            light: a.light * scale * t.cap_light,
            bounce: a.bounce * scale * t.cap_bounce,
            style: a.style * scale * t.cap_style,
            wear: a.wear * scale * t.cap_wear,
        }
    }
}

pub(crate) struct Prepared<'a> {
    pub w: usize,
    pub h: usize,
    pub job: &'a Job,
    pub orig: &'a [f32],
    pub passes: Passes<'a>,
    pub display: Display,
    /// The exposure's gain: scene-linear values times this are display-scaled.
    pub gain: f32,
    /// Display-linear RGB of the engine image.
    pub disp: Vec<f32>,
    /// Dense region index per pixel, [`BACKGROUND`] where `partId` is 0. The studio floor
    /// ([`FLOOR_ID`] in both ids) is a region like a material's: it may be relit, and its colour
    /// is checked.
    pub region: Vec<u32>,
    pub regions: Vec<Region>,
    /// Cosine of the crease angle.
    pub crease_cos: f32,
}

impl<'a> Prepared<'a> {
    pub fn new(job: &'a Job, original: &'a LinearImage, passes: Passes<'a>) -> Prepared<'a> {
        let (w, h) = (job.width as usize, job.height as usize);
        let display = Display::of(job);
        let disp = display.image(&original.rgba);
        // The material ids present on surfaces, in increasing order.
        let mut present = BTreeSet::new();
        let mut last = None;
        for (p, &part) in passes.part_id.iter().enumerate() {
            if part != 0 {
                let m = passes.material_id[p];
                if last != Some(m) {
                    present.insert(m);
                    last = Some(m);
                }
            }
        }
        let ids: Vec<u32> = present.into_iter().collect();
        let regions: Vec<Region> = ids
            .iter()
            .map(|&id| match job.materials.iter().find(|m| m.id == id) {
                Some(m) => Region {
                    id,
                    name: m.name.clone(),
                    allows_wear: m.allows_wear,
                    locked: m.locked,
                },
                // The floor's contact shadows and bounced light are what Light and Bounce improve;
                // it is no product material, so no wear enters it.
                None if id == FLOOR_ID => Region {
                    id,
                    name: FLOOR_NAME.into(),
                    allows_wear: false,
                    locked: false,
                },
                None => Region {
                    id,
                    name: format!("#{id}"),
                    allows_wear: false,
                    locked: false,
                },
            })
            .collect();
        let mut region = vec![BACKGROUND; w * h];
        // The last material id looked up and its region. `None` at first: every id, FLOOR_ID
        // (u32::MAX) included, is looked up the first time it is seen.
        let mut cache: Option<(u32, u32)> = None;
        for (p, r) in region.iter_mut().enumerate() {
            if passes.part_id[p] == 0 {
                continue;
            }
            let m = passes.material_id[p];
            let hit = cache.filter(|c| c.0 == m).map(|c| c.1);
            *r = match hit {
                Some(i) => i,
                None => {
                    // `ids` holds every id present, so the search always finds it.
                    let i = ids.binary_search(&m).unwrap_or(0) as u32;
                    cache = Some((m, i));
                    i
                }
            };
        }
        let crease_cos =
            rt_core::fmath::cos(job.tolerances.crease_deg * rt_core::fmath::DEG_TO_RAD);
        Prepared {
            w,
            h,
            job,
            orig: &original.rgba,
            passes,
            display,
            gain: rt_core::color::exposure(job.exposure_ev),
            disp,
            region,
            regions,
            crease_cos,
        }
    }

    /// Whether any control may change region `r` (with the controls of this job).
    pub fn region_open(&self, r: u32) -> bool {
        if r == BACKGROUND {
            return false;
        }
        let region = &self.regions[r as usize];
        let a = Aspects::of(self.job);
        let any = a.light > 0.0 || a.bounce > 0.0 || a.style > 0.0;
        !region.locked && (any || (a.wear > 0.0 && region.allows_wear))
    }

    /// Per pixel: whether a control may change it.
    pub fn open_mask(&self) -> Vec<bool> {
        let open: Vec<bool> = (0..self.regions.len() as u32)
            .map(|r| self.region_open(r))
            .collect();
        self.region
            .iter()
            .map(|&r| r != BACKGROUND && open[r as usize])
            .collect()
    }

    /// Per pixel: within `reach` pixels (a square) of an id or normal edge.
    pub fn near_edges(&self, reach: usize) -> Vec<bool> {
        let (w, h) = (self.w, self.h);
        let edges = crate::conditioning::edge_plane(&self.passes, self.crease_cos);
        let mut horiz = vec![false; w * h];
        for y in 0..h {
            // Distance to the last edge seen from the left and from the right.
            let mut last = usize::MAX;
            for x in 0..w {
                if edges[y * w + x] != 0 {
                    last = x;
                }
                horiz[y * w + x] = last != usize::MAX && x - last <= reach;
            }
            let mut next = usize::MAX;
            for x in (0..w).rev() {
                if edges[y * w + x] != 0 {
                    next = x;
                }
                if next != usize::MAX && next - x <= reach {
                    horiz[y * w + x] = true;
                }
            }
        }
        let mut out = vec![false; w * h];
        for x in 0..w {
            let mut last = usize::MAX;
            for y in 0..h {
                if horiz[y * w + x] {
                    last = y;
                }
                out[y * w + x] = last != usize::MAX && y - last <= reach;
            }
            let mut next = usize::MAX;
            for y in (0..h).rev() {
                if horiz[y * w + x] {
                    next = y;
                }
                if next != usize::MAX && next - y <= reach {
                    out[y * w + x] = true;
                }
            }
        }
        out
    }

    /// Circle of confusion at pixel `p` (0 without the pass).
    #[inline]
    pub fn coc(&self, p: usize) -> f32 {
        self.passes.coc.map_or(0.0, |c| {
            let v = c[p];
            if v.is_finite() {
                v.max(0.0)
            } else {
                0.0
            }
        })
    }
}

/// A sum in `f32` with Kahan's compensation: long sums keep their precision, in a fixed order.
#[derive(Clone, Copy, Default)]
pub(crate) struct Sum {
    sum: f32,
    carry: f32,
}

impl Sum {
    #[inline]
    pub fn add(&mut self, v: f32) {
        let y = v - self.carry;
        let t = self.sum + y;
        self.carry = (t - self.sum) - y;
        self.sum = t;
    }

    pub fn get(&self) -> f32 {
        self.sum
    }
}

/// Fixed-bin histogram of values in `[lo, hi)` (outside values go to the end bins), for
/// medians and percentiles that do not depend on any sort.
pub(crate) struct Histogram {
    lo: f32,
    width: f32,
    bins: Vec<u32>,
    count: u64,
    max: f32,
}

impl Histogram {
    pub fn new(lo: f32, hi: f32, bins: usize) -> Histogram {
        Histogram {
            lo,
            width: (hi - lo) / bins as f32,
            bins: vec![0; bins],
            count: 0,
            max: f32::NEG_INFINITY,
        }
    }

    #[inline]
    pub fn add(&mut self, v: f32) {
        let i = ((v - self.lo) / self.width).floor();
        let last = self.bins.len() - 1;
        let i = if i.is_nan() || i < 0.0 {
            0
        } else {
            (i as usize).min(last)
        };
        self.bins[i] += 1;
        self.count += 1;
        if v > self.max {
            self.max = v;
        }
    }

    pub fn count(&self) -> u64 {
        self.count
    }

    /// The value below which `q` of the samples lie, as the upper edge of its bin but never above
    /// the largest sample (0 when empty). For `q = 0.5` the bin's centre is returned instead (a
    /// median).
    pub fn quantile(&self, q: f32) -> f32 {
        if self.count == 0 {
            return 0.0;
        }
        let target = ((self.count as f64) * f64::from(q)).ceil().max(1.0) as u64;
        let mut seen = 0u64;
        for (i, &b) in self.bins.iter().enumerate() {
            seen += u64::from(b);
            if seen >= target {
                if q == 0.5 {
                    return self.lo + (i as f32 + 0.5) * self.width;
                }
                return (self.lo + (i as f32 + 1.0) * self.width).min(self.max);
            }
        }
        self.max
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kahan_sums_keep_their_precision() {
        let mut s = Sum::default();
        let mut naive = 0.0f32;
        for _ in 0..10_000_000 {
            s.add(0.1);
            naive += 0.1;
        }
        assert!((s.get() - 1_000_000.0).abs() < 1.0, "{}", s.get());
        assert!(
            (naive - 1_000_000.0).abs() > 1000.0,
            "the naive sum drifts: {naive}"
        );
    }

    #[test]
    fn histogram_quantiles() {
        let mut h = Histogram::new(0.0, 10.0, 1000);
        for i in 0..1000 {
            h.add(i as f32 / 100.0);
        }
        assert!(
            (h.quantile(0.5) - 4.995).abs() < 0.011,
            "{}",
            h.quantile(0.5)
        );
        assert!(
            (h.quantile(0.95) - 9.5).abs() < 0.011,
            "{}",
            h.quantile(0.95)
        );
        h.add(f32::NAN);
        h.add(1.0e9);
        assert_eq!(h.count(), 1002);
        assert_eq!(Histogram::new(0.0, 1.0, 4).quantile(0.95), 0.0);
        let mut zeros = Histogram::new(0.0, 1.0, 4);
        zeros.add(0.0);
        assert_eq!(zeros.quantile(0.95), 0.0, "never above the largest sample");
    }
}

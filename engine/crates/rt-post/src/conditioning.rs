//! Conditioning (AI-POST.md §3.2 step 2): the control images computed from the exact passes, never
//! from the picture. Edges are the discontinuities of part id, material id and normal; depth is
//! normalised over the whole image's finite depths, near bright and far dark (the ControlNet
//! convention), background black. Both are 8-bit, one byte a pixel.

use crate::image::Passes;

/// Darkest depth value a surface gets (the farthest one): above the background's 0, so the
/// farthest surface still separates from it.
pub const DEPTH_FAR: u8 = 16;

/// Whether pixels `p` and `q` lie on two sides of an edge: another part, another material, or
/// (both on a surface) normals more than the crease angle apart (`crease_cos` is its cosine).
#[inline]
pub(crate) fn discontinuity(passes: &Passes, p: usize, q: usize, crease_cos: f32) -> bool {
    if passes.part_id[p] != passes.part_id[q] || passes.material_id[p] != passes.material_id[q] {
        return true;
    }
    if passes.part_id[p] == 0 {
        return false;
    }
    match passes.normal {
        Some(n) => {
            let (a, b) = (&n[p * 3..p * 3 + 3], &n[q * 3..q * 3 + 3]);
            a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < crease_cos
        }
        None => false,
    }
}

/// The edge image: 255 on both sides of every discontinuity between 4-neighbours, else 0.
pub(crate) fn edge_plane(passes: &Passes, crease_cos: f32) -> Vec<u8> {
    let (w, h) = (passes.width as usize, passes.height as usize);
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let p = y * w + x;
            if x + 1 < w && discontinuity(passes, p, p + 1, crease_cos) {
                out[p] = 255;
                out[p + 1] = 255;
            }
            if y + 1 < h && discontinuity(passes, p, p + w, crease_cos) {
                out[p] = 255;
                out[p + w] = 255;
            }
        }
    }
    out
}

/// The depth image: the nearest surface 255, the farthest [`DEPTH_FAR`], linear in between;
/// background (part 0 or a depth that is not finite) 0. Without a depth pass, all 0.
pub(crate) fn depth_plane(passes: &Passes) -> Vec<u8> {
    let n = passes.width as usize * passes.height as usize;
    let Some(depth) = passes.depth else {
        return vec![0; n];
    };
    let surface = |p: usize| passes.part_id[p] != 0 && depth[p].is_finite();
    let (mut near, mut far) = (f32::INFINITY, f32::NEG_INFINITY);
    for (p, &d) in depth.iter().enumerate() {
        if surface(p) {
            near = near.min(d);
            far = far.max(d);
        }
    }
    let span = far - near;
    let range = f32::from(255 - DEPTH_FAR);
    (0..n)
        .map(|p| {
            if !surface(p) {
                0
            } else if span > 0.0 {
                let t = ((far - depth[p]) / span).clamp(0.0, 1.0);
                (f32::from(DEPTH_FAR) + range * t + 0.5) as u8
            } else {
                255
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_come_from_ids_and_creases_only() {
        // 6 x 3: background | part 1 (two normals, a crease between columns 2 and 3) | part 2.
        let part = [0, 1, 1, 1, 2, 2].repeat(3);
        let material = [0, 1, 1, 1, 1, 1].repeat(3);
        let mut normal = Vec::new();
        for _ in 0..3 {
            for x in 0..6 {
                normal.extend_from_slice(match x {
                    0 => &[0.0, 0.0, 0.0],
                    1 | 2 => &[0.0, 0.0, 1.0],
                    3 => &[1.0, 0.0, 0.0],
                    _ => &[0.0, 0.0, 1.0],
                });
            }
        }
        let passes = Passes {
            width: 6,
            height: 3,
            part_id: &part,
            material_id: &material,
            normal: Some(&normal),
            depth: None,
            coc: None,
        };
        let edges = edge_plane(&passes, 0.866);
        // Columns 0|1 (part), 2|3 (crease), 3|4 (part); rows are identical, so no horizontal
        // edges, and column 5 borders nothing.
        assert_eq!(&edges[..6], &[255, 255, 255, 255, 255, 0]);
        let no_normals = Passes {
            normal: None,
            ..passes
        };
        let edges = edge_plane(&no_normals, 0.866);
        assert_eq!(&edges[..6], &[255, 255, 0, 255, 255, 0]);
        // Background next to background never makes an edge, even with zero normals.
        let bg = [0u32; 4];
        let zero = [0.0f32; 12];
        let passes = Passes {
            width: 2,
            height: 2,
            part_id: &bg,
            material_id: &bg,
            normal: Some(&zero),
            depth: None,
            coc: None,
        };
        assert_eq!(edge_plane(&passes, 0.866), vec![0; 4]);
    }

    #[test]
    fn depth_is_normalised_over_the_whole_image() {
        let part = [0, 1, 1, 1];
        let depth = [f32::INFINITY, 100.0, 150.0, 200.0];
        let passes = Passes {
            width: 4,
            height: 1,
            part_id: &part,
            material_id: &part,
            normal: None,
            depth: Some(&depth),
            coc: None,
        };
        assert_eq!(depth_plane(&passes), vec![0, 255, 136, DEPTH_FAR]);
        let flat = [0.0, 5.0, 5.0, 5.0];
        let passes = Passes {
            depth: Some(&flat),
            ..passes
        };
        assert_eq!(depth_plane(&passes), vec![0, 255, 255, 255]);
        let passes = Passes {
            depth: None,
            ..passes
        };
        assert_eq!(depth_plane(&passes), vec![0; 4]);
    }
}

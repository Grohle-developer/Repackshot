//! The surface of a liquid (S7): a colour field of the particles on a grid and its iso-surface
//! by marching cubes (Lorensen and Cline, "Marching Cubes: A High Resolution 3D Surface
//! Construction Algorithm", SIGGRAPH 1987), written from the paper.
//!
//! **The field.** `φ(x) = Σ_j w(|x − x_j|) / n₀` with `w(r) = (1 − r²/H²)³` for `r < H`
//! ([`SURFACE_RADIUS`] particle spacings), and `n₀` the sum of `w` over the close packing of the
//! particles (a face-centred cubic lattice, [`lattice_sum`]): `φ` is about one inside the liquid
//! and falls to zero outside, and at a flat face the level ½ lies about where the particles'
//! share of the volume ends, so the surface at [`ISO`] encloses the particles' volume.
//!
//! **The table** of the 256 corner cases is not copied from anywhere: it is built at each call
//! from a rule on the faces. On a face whose diagonal corners are inside and the other two
//! outside, the inside corners are kept apart (the segments cut each of them off); every face
//! decides from its own corners, so two cells that share a face cut it the same way and the
//! surface has no holes. The segments are oriented with the inside on their left seen from
//! outside the cube, chained into loops (every crossed edge ends one segment and starts another)
//! and each loop is a fan of triangles. The triangles face out of the liquid (towards lower `φ`).
//!
//! Everything is `f32` but the volume (an `f64` sum); the order of every sum is fixed, so the
//! same particles give the same mesh, bit for bit, on every platform.

use rt_core::math::Vec3;

/// The radius of the field's kernel, in particle spacings.
pub const SURFACE_RADIUS: f32 = 2.0;
/// The level of the surface.
pub const ISO: f32 = 0.5;
/// The grid's cell, in particle spacings.
pub const CELL: f32 = 0.5;
/// Most grid points of one surface: past it the cell grows (a coarser surface, never a refusal).
pub const MAX_GRID_POINTS: usize = 1 << 22;

/// A triangle mesh: positions, unit normals (one per vertex) and three indices per triangle.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SurfaceMesh {
    /// Vertex positions, mm.
    pub positions: Vec<Vec3>,
    /// Unit normals, pointing out of the liquid.
    pub normals: Vec<Vec3>,
    /// Three per triangle, counter-clockwise seen from outside.
    pub indices: Vec<u32>,
}

impl SurfaceMesh {
    /// The volume it encloses, mm³ (the divergence theorem over its triangles; positive for a
    /// closed mesh that faces out).
    pub fn volume(&self) -> f64 {
        mesh_volume(&self.positions, &self.indices)
    }

    /// Bytes for the page: `u32 vertices, u32 indices, f32 positions[3n], f32 normals[3n],
    /// u32 indices[m]`, little-endian.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + 24 * self.positions.len() + 4 * self.indices.len());
        out.extend_from_slice(&(self.positions.len() as u32).to_le_bytes());
        out.extend_from_slice(&(self.indices.len() as u32).to_le_bytes());
        for list in [&self.positions, &self.normals] {
            for p in list.iter() {
                for v in [p.x, p.y, p.z] {
                    out.extend_from_slice(&v.to_le_bytes());
                }
            }
        }
        for &i in &self.indices {
            out.extend_from_slice(&i.to_le_bytes());
        }
        out
    }
}

/// The volume enclosed by a closed, outward-facing triangle mesh, mm³.
pub fn mesh_volume(positions: &[Vec3], indices: &[u32]) -> f64 {
    let mut sum = 0.0f64;
    for t in indices.chunks_exact(3) {
        let p = |i: u32| {
            let v = positions[i as usize];
            [f64::from(v.x), f64::from(v.y), f64::from(v.z)]
        };
        let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
        let cross = [
            b[1] * c[2] - b[2] * c[1],
            b[2] * c[0] - b[0] * c[2],
            b[0] * c[1] - b[1] * c[0],
        ];
        sum += a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2];
    }
    sum / 6.0
}

/// A scalar field sampled on a regular grid of points.
#[derive(Clone, Debug)]
pub struct Field {
    /// The first grid point.
    pub origin: Vec3,
    /// The distance between grid points.
    pub cell: f32,
    /// Grid points along x, y and z.
    pub dims: [usize; 3],
    /// `values[x + dims[0] (y + dims[1] z)]`.
    pub values: Vec<f32>,
}

impl Field {
    /// A field of zeros.
    pub fn zeros(origin: Vec3, cell: f32, dims: [usize; 3]) -> Field {
        Field {
            origin,
            cell,
            dims,
            values: vec![0.0; dims[0] * dims[1] * dims[2]],
        }
    }

    #[inline]
    fn at(&self, x: usize, y: usize, z: usize) -> f32 {
        self.values[x + self.dims[0] * (y + self.dims[1] * z)]
    }

    #[inline]
    fn point(&self, x: usize, y: usize, z: usize) -> Vec3 {
        self.origin + Vec3::new(x as f32, y as f32, z as f32) * self.cell
    }

    /// The gradient at a grid point (central differences, one-sided at the border).
    fn gradient(&self, x: usize, y: usize, z: usize) -> Vec3 {
        let d = |lo: f32, hi: f32, two: bool| if two { (hi - lo) * 0.5 } else { hi - lo };
        let [nx, ny, nz] = self.dims;
        let (x0, x1) = (x.saturating_sub(1), (x + 1).min(nx - 1));
        let (y0, y1) = (y.saturating_sub(1), (y + 1).min(ny - 1));
        let (z0, z1) = (z.saturating_sub(1), (z + 1).min(nz - 1));
        Vec3::new(
            d(self.at(x0, y, z), self.at(x1, y, z), x1 - x0 == 2),
            d(self.at(x, y0, z), self.at(x, y1, z), y1 - y0 == 2),
            d(self.at(x, y, z0), self.at(x, y, z1), z1 - z0 == 2),
        ) * (1.0 / self.cell)
    }
}

/// The kernel of the field, unnormalised: `(1 − r²/h²)³` within `h`.
#[inline]
pub fn kernel(r2: f32, h2: f32) -> f32 {
    if r2 >= h2 {
        return 0.0;
    }
    let q = 1.0 - r2 / h2;
    q * q * q
}

/// The side of the cubic cell of the face-centred cubic lattice of `spacing`: four particles per
/// cell, so each stands for `spacing³` (the liquid's particles settle into a close packing, and
/// are filled as one: [`super::fill`]).
pub fn fcc_cell(spacing: f32) -> f32 {
    // 4^(1/3).
    1.587_401 * spacing
}

/// The sum of [`kernel`] of radius `h` over the face-centred cubic lattice of `spacing` around
/// one of its points (itself included): the points of the cubic grid of half the cell whose
/// indices add up to an even number.
pub fn lattice_sum(spacing: f32, h: f32) -> f32 {
    let half = 0.5 * fcc_cell(spacing);
    let n = (h / half) as i32 + 1;
    let h2 = h * h;
    let mut sum = 0.0f32;
    for z in -n..=n {
        for y in -n..=n {
            for x in -n..=n {
                if (x + y + z).rem_euclid(2) != 0 {
                    continue;
                }
                let p = Vec3::new(x as f32, y as f32, z as f32) * half;
                sum += kernel(p.length_squared(), h2);
            }
        }
    }
    sum
}

/// The colour field of particles of `spacing` mm, on a grid that has room around them for the
/// whole surface (its border points are outside the liquid). `None` without particles.
pub fn particle_field(points: &[Vec3], spacing: f32) -> Option<Field> {
    if points.is_empty() || !(spacing > 0.0 && spacing.is_finite()) {
        return None;
    }
    let h = SURFACE_RADIUS * spacing;
    let mut lo = points[0];
    let mut hi = points[0];
    for p in points {
        lo = lo.min(*p);
        hi = hi.max(*p);
    }
    let mut cell = CELL * spacing;
    let margin = h + 2.0 * cell;
    let (lo, hi) = (lo - Vec3::splat(margin), hi + Vec3::splat(margin));
    let size = hi - lo;
    let mut dims;
    loop {
        dims = [
            (size.x / cell) as usize + 2,
            (size.y / cell) as usize + 2,
            (size.z / cell) as usize + 2,
        ];
        if dims[0].saturating_mul(dims[1]).saturating_mul(dims[2]) <= MAX_GRID_POINTS {
            break;
        }
        cell *= 1.25;
    }
    let mut field = Field::zeros(lo, cell, dims);
    let n0 = lattice_sum(spacing, h);
    let h2 = h * h;
    let reach = (h / cell) as i64 + 1;
    for p in points {
        let g = (*p - lo) * (1.0 / cell);
        let (cx, cy, cz) = (g.x as i64, g.y as i64, g.z as i64);
        let clamp = |v: i64, n: usize| v.clamp(0, n as i64 - 1) as usize;
        let (x0, x1) = (clamp(cx - reach, dims[0]), clamp(cx + reach + 1, dims[0]));
        let (y0, y1) = (clamp(cy - reach, dims[1]), clamp(cy + reach + 1, dims[1]));
        let (z0, z1) = (clamp(cz - reach, dims[2]), clamp(cz + reach + 1, dims[2]));
        for z in z0..=z1 {
            for y in y0..=y1 {
                let row = dims[0] * (y + dims[1] * z);
                for x in x0..=x1 {
                    let q = field.point(x, y, z) - *p;
                    let w = kernel(q.length_squared(), h2);
                    if w > 0.0 {
                        field.values[row + x] += w / n0;
                    }
                }
            }
        }
    }
    Some(field)
}

/// The surface of particles of `spacing` mm (empty without particles).
pub fn surface(points: &[Vec3], spacing: f32) -> SurfaceMesh {
    match particle_field(points, spacing) {
        Some(f) => march(&f, ISO),
        None => SurfaceMesh::default(),
    }
}

// ------------------------------------------------------------------ the case table

/// The cube's corners: bit 0 is x, bit 1 y, bit 2 z.
fn corner(c: usize) -> Vec3 {
    Vec3::new((c & 1) as f32, ((c >> 1) & 1) as f32, ((c >> 2) & 1) as f32)
}

/// The cube's twelve edges as (corner, corner): four along x, four along y, four along z, the
/// first corner the lower one.
const EDGES: [(usize, usize); 12] = [
    (0, 1),
    (2, 3),
    (4, 5),
    (6, 7),
    (0, 2),
    (1, 3),
    (4, 6),
    (5, 7),
    (0, 4),
    (1, 5),
    (2, 6),
    (3, 7),
];

fn edge_of(a: usize, b: usize) -> usize {
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    EDGES
        .iter()
        .position(|&e| e == (lo, hi))
        .expect("an edge of the cube")
}

/// The six faces: their corners in a cycle and their outward normal.
fn faces() -> [([usize; 4], Vec3); 6] {
    let mut out = [([0usize; 4], Vec3::ZERO); 6];
    let mut k = 0;
    for axis in 0..3 {
        let (u, w) = ((axis + 1) % 3, (axis + 2) % 3);
        for side in 0..2 {
            let at = |a: usize, b: usize| (side << axis) | (a << u) | (b << w);
            let mut n = Vec3::ZERO;
            let s = if side == 1 { 1.0 } else { -1.0 };
            match axis {
                0 => n.x = s,
                1 => n.y = s,
                _ => n.z = s,
            }
            out[k] = ([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], n);
            k += 1;
        }
    }
    out
}

/// For each of the 256 cases (bit `c` set: corner `c` is inside), its triangles as triples of
/// edges.
pub fn case_table() -> Vec<Vec<[u8; 3]>> {
    let faces = faces();
    let mid = |e: usize| (corner(EDGES[e].0) + corner(EDGES[e].1)) * 0.5;
    (0..256usize)
        .map(|case| {
            let inside = |c: usize| case & (1 << c) != 0;
            // next[e]: the edge the oriented segment that starts at edge e ends at.
            let mut next = [usize::MAX; 12];
            for (corners, n) in faces.iter() {
                let crossed: Vec<usize> = (0..4)
                    .filter(|&k| inside(corners[k]) != inside(corners[(k + 1) % 4]))
                    .collect();
                // Segments of this face, each with an inside corner on its inside.
                let mut segments: Vec<(usize, usize, usize)> = Vec::new();
                match crossed.len() {
                    2 => {
                        let side = (0..4).map(|k| corners[k]).find(|&c| inside(c));
                        let e = |k: usize| edge_of(corners[k], corners[(k + 1) % 4]);
                        if let Some(q) = side {
                            segments.push((e(crossed[0]), e(crossed[1]), q));
                        }
                    }
                    4 => {
                        // The diagonal case: cut off each inside corner.
                        for k in 0..4 {
                            if inside(corners[k]) {
                                let before = edge_of(corners[(k + 3) % 4], corners[k]);
                                let after = edge_of(corners[k], corners[(k + 1) % 4]);
                                segments.push((before, after, corners[k]));
                            }
                        }
                    }
                    _ => {}
                }
                for (a, b, q) in segments {
                    let (p1, p2) = (mid(a), mid(b));
                    let left = (p2 - p1).cross(corner(q) - p1).dot(*n) > 0.0;
                    let (from, to) = if left { (a, b) } else { (b, a) };
                    next[from] = to;
                }
            }
            let mut tris = Vec::new();
            let mut seen = [false; 12];
            for start in 0..12 {
                if next[start] == usize::MAX || seen[start] {
                    continue;
                }
                let mut ring = Vec::new();
                let mut e = start;
                while !seen[e] {
                    seen[e] = true;
                    ring.push(e);
                    e = next[e];
                    if e == usize::MAX {
                        break;
                    }
                }
                // The loop runs round the inside counter-clockwise seen from it: reversed, the
                // triangles face out.
                for i in 1..ring.len().saturating_sub(1) {
                    tris.push([ring[0] as u8, ring[i + 1] as u8, ring[i] as u8]);
                }
            }
            tris
        })
        .collect()
}

// ------------------------------------------------------------------ marching

/// The iso-surface `φ = iso` of a field: closed wherever the field's border is below `iso`,
/// facing towards lower values.
pub fn march(field: &Field, iso: f32) -> SurfaceMesh {
    let table = case_table();
    let [nx, ny, nz] = field.dims;
    let mut mesh = SurfaceMesh::default();
    if nx < 2 || ny < 2 || nz < 2 {
        return mesh;
    }
    let plane = nx * ny;
    // The vertex of each grid edge of the two levels in hand: x and y edges of level z (slot
    // z & 1), and z edges from level z to z + 1.
    let mut xy = [vec![u32::MAX; 2 * plane], vec![u32::MAX; 2 * plane]];
    let mut zs = vec![u32::MAX; plane];
    let inside = |v: f32| v > iso;
    for z in 0..nz - 1 {
        // The level z + 1 starts empty.
        xy[(z + 1) & 1].iter_mut().for_each(|v| *v = u32::MAX);
        zs.iter_mut().for_each(|v| *v = u32::MAX);
        for y in 0..ny - 1 {
            for x in 0..nx - 1 {
                let mut case = 0usize;
                for c in 0..8 {
                    let (dx, dy, dz) = (c & 1, (c >> 1) & 1, (c >> 2) & 1);
                    if inside(field.at(x + dx, y + dy, z + dz)) {
                        case |= 1 << c;
                    }
                }
                if case == 0 || case == 255 {
                    continue;
                }
                for tri in &table[case] {
                    let mut ids = [0u32; 3];
                    for (k, &e) in tri.iter().enumerate() {
                        let (a, b) = EDGES[e as usize];
                        let (ax, ay, az) = (x + (a & 1), y + ((a >> 1) & 1), z + ((a >> 2) & 1));
                        let slot = match e / 4 {
                            0 => &mut xy[az & 1][ax + nx * ay],
                            1 => &mut xy[az & 1][plane + ax + nx * ay],
                            _ => &mut zs[ax + nx * ay],
                        };
                        if *slot == u32::MAX {
                            let (bx, by, bz) =
                                (x + (b & 1), y + ((b >> 1) & 1), z + ((b >> 2) & 1));
                            let (va, vb) = (field.at(ax, ay, az), field.at(bx, by, bz));
                            let t = if vb != va {
                                ((iso - va) / (vb - va)).clamp(0.0, 1.0)
                            } else {
                                0.5
                            };
                            let (pa, pb) = (field.point(ax, ay, az), field.point(bx, by, bz));
                            let ga = field.gradient(ax, ay, az);
                            let gb = field.gradient(bx, by, bz);
                            let g = ga + (gb - ga) * t;
                            mesh.positions.push(pa + (pb - pa) * t);
                            mesh.normals.push((-g).normalize());
                            *slot = mesh.positions.len() as u32 - 1;
                        }
                        ids[k] = *slot;
                    }
                    if ids[0] != ids[1] && ids[1] != ids[2] && ids[0] != ids[2] {
                        mesh.indices.extend_from_slice(&ids);
                    }
                }
            }
        }
    }
    mesh
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Closed and oriented: every edge of the mesh is used as often one way as the other (two
    /// sheets that touch along an edge, where four triangles meet, are allowed).
    pub(crate) fn watertight(indices: &[u32]) -> bool {
        let mut directed: Vec<(u32, u32)> = Vec::new();
        for t in indices.chunks_exact(3) {
            for k in 0..3 {
                directed.push((t[k], t[(k + 1) % 3]));
            }
        }
        directed.sort_unstable();
        let count = |e: (u32, u32)| {
            directed.partition_point(|&x| x <= e) - directed.partition_point(|&x| x < e)
        };
        directed
            .iter()
            .all(|&(a, b)| count((a, b)) == count((b, a)))
    }

    #[test]
    fn every_case_closes_its_loops() {
        let table = case_table();
        assert!(table[0].is_empty() && table[255].is_empty());
        // One corner in: one triangle; its complement too.
        assert_eq!(table[1].len(), 1);
        assert_eq!(table[254].len(), 1);
        for (case, tris) in table.iter().enumerate() {
            // The edges the triangles touch are exactly the crossed ones.
            let inside = |c: usize| case & (1 << c) != 0;
            let mut crossed: Vec<u8> = (0..12u8)
                .filter(|&e| inside(EDGES[e as usize].0) != inside(EDGES[e as usize].1))
                .collect();
            let mut used: Vec<u8> = tris.iter().flatten().copied().collect();
            used.sort_unstable();
            used.dedup();
            crossed.sort_unstable();
            assert_eq!(used, crossed, "case {case}");
        }
    }

    #[test]
    fn random_fields_give_closed_surfaces() {
        let mut state = 0x1234_5678u32;
        let mut rand = || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            (state >> 8) as f32 / (1u32 << 24) as f32
        };
        for _ in 0..20 {
            let mut f = Field::zeros(Vec3::ZERO, 1.0, [9, 8, 7]);
            for z in 1..6 {
                for y in 1..7 {
                    for x in 1..8 {
                        f.values[x + 9 * (y + 8 * z)] = rand();
                    }
                }
            }
            let m = march(&f, 0.5);
            assert!(!m.indices.is_empty());
            assert!(watertight(&m.indices));
            assert!(m.volume() > 0.0);
        }
    }

    #[test]
    fn a_sphere_has_its_volume_and_faces_out() {
        let r = 10.0f32;
        let cell = 0.5f32;
        let mut f = Field::zeros(Vec3::splat(-13.0), cell, [53, 53, 53]);
        for z in 0..53 {
            for y in 0..53 {
                for x in 0..53 {
                    let p = f.point(x, y, z);
                    f.values[x + 53 * (y + 53 * z)] = r - p.length();
                }
            }
        }
        let m = march(&f, 0.0);
        assert!(watertight(&m.indices));
        let want = 4.0 / 3.0 * std::f64::consts::PI * f64::from(r).powi(3);
        assert!((m.volume() / want - 1.0).abs() < 0.005, "{}", m.volume());
        for (p, n) in m.positions.iter().zip(&m.normals) {
            assert!(n.dot(p.normalize()) > 0.99);
        }
    }

    #[test]
    fn a_block_of_particles_has_its_volume() {
        // A close-packed block of particles 2 mm apart (cubes of 40 and 60 mm, filled as a liquid
        // is) has the volume they stand for on their lattice, `N s³`. (The fill's own spacing makes
        // them stand for the cube's volume; how far that is from `N s³` depends on how the lattice
        // falls against the cube's faces, and the simulation settles the liquid at it.)
        let s = 2.0f32;
        for half in [20.0f32, 30.0] {
            let cube = crate::example::box_mesh(Vec3::splat(half));
            let (pts, _) = crate::liquid::fill::fill(&cube.positions, &cube.indices, s);
            let m = surface(&pts, s);
            assert!(watertight(&m.indices));
            let want = pts.len() as f64 * f64::from(s).powi(3);
            let got = m.volume();
            assert!((got / want - 1.0).abs() < 0.03, "{half}: {got} vs {want}");
        }
    }
}

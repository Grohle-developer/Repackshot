//! The static geometry: every static part and the floor as one soup of world-space triangles,
//! with a binary tree of boxes for the queries "which triangles may touch this box". The tree is
//! split at the median of the longest axis of the centroids (ties by index), so it is the same on
//! every platform; leaves hold at most [`LEAF_SIZE`] triangles.

use rt_core::math::{Aabb, Vec3};

/// Most triangles in a leaf.
pub const LEAF_SIZE: usize = 4;

/// One static triangle and the surface parameters of the part it belongs to.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StaticTri {
    /// The corners, world space.
    pub v: [Vec3; 3],
    /// Unit normal (counter-clockwise), or zero for a degenerate triangle.
    pub n: Vec3,
    /// Coulomb friction of the part.
    pub friction: f32,
    /// Restitution of the part.
    pub restitution: f32,
}

#[derive(Clone, Copy, Debug)]
struct Node {
    bounds: Aabb,
    /// Inner node: index of the left child (the right one follows it). Leaf: first triangle.
    first: u32,
    /// 0 for an inner node, else the number of triangles of the leaf.
    count: u32,
}

/// The static triangles and their tree.
#[derive(Clone, Debug, Default)]
pub struct StaticMesh {
    tris: Vec<StaticTri>,
    nodes: Vec<Node>,
    dirty: bool,
}

fn tri_bounds(t: &StaticTri) -> Aabb {
    Aabb::new(
        t.v[0].min(t.v[1]).min(t.v[2]),
        t.v[0].max(t.v[1]).max(t.v[2]),
    )
}

fn overlaps(a: &Aabb, b: &Aabb) -> bool {
    a.min.x <= b.max.x
        && b.min.x <= a.max.x
        && a.min.y <= b.max.y
        && b.min.y <= a.max.y
        && a.min.z <= b.max.z
        && b.min.z <= a.max.z
}

impl StaticMesh {
    /// Number of triangles.
    pub fn len(&self) -> usize {
        self.tris.len()
    }

    /// True without triangles.
    pub fn is_empty(&self) -> bool {
        self.tris.is_empty()
    }

    /// Triangle `i` (in tree order once the tree is built).
    pub fn tri(&self, i: usize) -> &StaticTri {
        &self.tris[i]
    }

    /// Adds triangles; the tree is rebuilt on the next query.
    pub fn add(&mut self, positions: &[Vec3], indices: &[u32], friction: f32, restitution: f32) {
        for t in indices.chunks_exact(3) {
            let (Some(&a), Some(&b), Some(&c)) = (
                positions.get(t[0] as usize),
                positions.get(t[1] as usize),
                positions.get(t[2] as usize),
            ) else {
                continue;
            };
            if !(a.is_finite() && b.is_finite() && c.is_finite()) {
                continue;
            }
            let n = (b - a).cross(c - a);
            if !crate::math::above(n.length(), 0.0) {
                continue;
            }
            self.tris.push(StaticTri {
                v: [a, b, c],
                n: n.normalize(),
                friction,
                restitution,
            });
        }
        self.dirty = true;
    }

    /// Builds the tree (also reorders the triangles into leaf order).
    pub fn build(&mut self) {
        self.dirty = false;
        self.nodes.clear();
        if self.tris.is_empty() {
            return;
        }
        let centroids: Vec<Vec3> = self
            .tris
            .iter()
            .map(|t| (t.v[0] + t.v[1] + t.v[2]) * (1.0 / 3.0))
            .collect();
        let mut order: Vec<u32> = (0..self.tris.len() as u32).collect();
        self.nodes.push(Node {
            bounds: Aabb::EMPTY,
            first: 0,
            count: 0,
        });
        // (node, start, end) of `order`.
        let mut stack = vec![(0usize, 0usize, order.len())];
        while let Some((node, start, end)) = stack.pop() {
            let mut b = Aabb::EMPTY;
            let mut cb = Aabb::EMPTY;
            for &i in &order[start..end] {
                b = b.union(tri_bounds(&self.tris[i as usize]));
                cb = cb.extend(centroids[i as usize]);
            }
            self.nodes[node].bounds = b;
            if end - start <= LEAF_SIZE {
                self.nodes[node].first = start as u32;
                self.nodes[node].count = (end - start) as u32;
                continue;
            }
            let size = cb.max - cb.min;
            let axis = if size.x >= size.y && size.x >= size.z {
                0
            } else if size.y >= size.z {
                1
            } else {
                2
            };
            let key = |i: u32| {
                let c = centroids[i as usize];
                match axis {
                    0 => c.x,
                    1 => c.y,
                    _ => c.z,
                }
            };
            order[start..end].sort_by(|&a, &b| key(a).total_cmp(&key(b)).then(a.cmp(&b)));
            let mid = (start + end) / 2;
            let left = self.nodes.len();
            self.nodes.push(Node {
                bounds: Aabb::EMPTY,
                first: 0,
                count: 0,
            });
            self.nodes.push(Node {
                bounds: Aabb::EMPTY,
                first: 0,
                count: 0,
            });
            self.nodes[node].first = left as u32;
            stack.push((left + 1, mid, end));
            stack.push((left, start, mid));
        }
        self.tris = order.iter().map(|&i| self.tris[i as usize]).collect();
    }

    /// Appends to `out` the triangles whose boxes overlap `query`, in tree order.
    pub fn query(&mut self, query: &Aabb, out: &mut Vec<u32>) {
        if self.dirty {
            self.build();
        }
        if self.nodes.is_empty() {
            return;
        }
        let mut stack = vec![0u32];
        while let Some(n) = stack.pop() {
            let node = self.nodes[n as usize];
            if !overlaps(&node.bounds, query) {
                continue;
            }
            if node.count > 0 {
                for i in node.first..node.first + node.count {
                    if overlaps(&tri_bounds(&self.tris[i as usize]), query) {
                        out.push(i);
                    }
                }
            } else {
                stack.push(node.first + 1);
                stack.push(node.first);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tree_finds_what_brute_force_finds() {
        let mut mesh = StaticMesh::default();
        let mut pos = Vec::new();
        let mut idx = Vec::new();
        for i in 0..40 {
            for j in 0..40 {
                let base = pos.len() as u32;
                let p = Vec3::new(
                    i as f32 * 10.0,
                    j as f32 * 10.0,
                    ((i * 7 + j * 3) % 5) as f32,
                );
                pos.push(p);
                pos.push(p + Vec3::new(10.0, 0.0, 0.0));
                pos.push(p + Vec3::new(0.0, 10.0, 1.0));
                idx.extend_from_slice(&[base, base + 1, base + 2]);
            }
        }
        mesh.add(&pos, &idx, 0.5, 0.0);
        let q = Aabb::new(Vec3::new(55.0, 105.0, -1.0), Vec3::new(98.0, 133.0, 2.5));
        let mut got = Vec::new();
        mesh.query(&q, &mut got);
        got.sort_unstable();
        let mut want: Vec<u32> = (0..mesh.len() as u32)
            .filter(|&i| overlaps(&tri_bounds(mesh.tri(i as usize)), &q))
            .collect();
        want.sort_unstable();
        assert!(!want.is_empty());
        assert_eq!(got, want);
    }
}

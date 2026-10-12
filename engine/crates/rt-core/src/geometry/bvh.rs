//! Bounding volume hierarchies: a binned SAH build of a binary tree, collapsed into a wide tree
//! (4 or 8 children per node) whose child boxes are stored structure-of-arrays, so one SIMD
//! slab test checks every child of a node against a ray.
//!
//! **Build.** Top-down, binned surface area heuristic (Wald, "On fast Construction of SAH-based
//! Bounding Volume Hierarchies", 2007): [`BINS`] bins per axis over the centroid bounds, the
//! cheapest of the `3 * (BINS - 1)` planes wins, a node becomes a leaf when it holds at most
//! `leaf_target` primitives, or when the SAH says a leaf is cheaper (up to `leaf_max`
//! primitives). Primitives that cannot be separated (identical centroids), and every node below
//! depth [`SAH_DEPTH_LIMIT`], are split at the median of their current order, which bounds the
//! depth by `SAH_DEPTH_LIMIT + log2(n)`.
//!
//! **Collapse.** Each wide node takes the two children of a binary node and keeps opening the
//! inner child with the largest surface area until it has `N` children or only leaves.
//!
//! **Determinism.** No hash maps, no parallelism, no sorting of floats: binning, partitioning
//! (a two-pointer swap over the primitive order) and every tie-break (first axis, first plane,
//! first child) depend only on the input and on IEEE arithmetic, so two builds of the same input
//! produce identical arrays on every platform.

use crate::math::{Aabb, Vec3};
use crate::simd::Isa;

/// Number of bins per axis of the SAH build.
pub const BINS: usize = 16;
/// Below this depth the SAH chooses the splits; from it on, nodes are split at the median.
pub const SAH_DEPTH_LIMIT: u32 = 32;
/// SAH cost of visiting a node, relative to one primitive test.
const TRAVERSAL_COST: f32 = 1.0;
/// SAH cost of one primitive test.
const PRIMITIVE_COST: f32 = 1.0;

/// Child reference of an empty slot.
pub(crate) const EMPTY: u32 = u32::MAX;
/// Bit set in a child reference that points to a leaf.
pub(crate) const LEAF: u32 = 1 << 31;
/// A leaf reference is `LEAF | first << COUNT_BITS | (count - 1)`.
const COUNT_BITS: u32 = 3;
/// Largest number of items (packets or instances) in a leaf.
pub(crate) const MAX_LEAF_ITEMS: usize = 1 << COUNT_BITS;
/// Largest `first` index a leaf can address (keeps every leaf reference different from
/// [`EMPTY`]).
pub(crate) const MAX_LEAF_FIRST: usize = (1 << (31 - COUNT_BITS)) - 2;

/// Encodes a leaf reference. `count` must be in `1..=MAX_LEAF_ITEMS`.
#[inline]
pub(crate) fn leaf_ref(first: usize, count: usize) -> u32 {
    LEAF | ((first as u32) << COUNT_BITS) | (count as u32 - 1)
}

/// Decodes a leaf reference into `(first, count)`.
#[inline(always)]
pub(crate) fn leaf_range(reference: u32) -> (usize, usize) {
    (
        ((reference & !LEAF) >> COUNT_BITS) as usize,
        (reference & ((1 << COUNT_BITS) - 1)) as usize + 1,
    )
}

/// Number of children per node of a wide BVH.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BvhWidth {
    /// Four children (BVH4): one 128-bit slab test per node.
    Four,
    /// Eight children (BVH8): one 256-bit slab test per node.
    Eight,
}

impl BvhWidth {
    /// The width that suits the running machine: eight when it has 8-lane SIMD (AVX2), four
    /// otherwise. Any width can be traversed on any machine; this only picks the faster one.
    pub fn native() -> BvhWidth {
        if Isa::detect().lanes() >= 8 {
            BvhWidth::Eight
        } else {
            BvhWidth::Four
        }
    }

    /// Children per node.
    pub fn lanes(self) -> usize {
        match self {
            BvhWidth::Four => 4,
            BvhWidth::Eight => 8,
        }
    }
}

/// A wide node: the boxes of its `N` children, structure-of-arrays, and their references.
///
/// `bounds` is `[min_x, max_x, min_y, max_y, min_z, max_z]`, one lane per child. Empty slots have
/// an empty box (`min = +inf`, `max = -inf`), which no ray hits, and the reference [`EMPTY`].
#[derive(Clone, Debug, PartialEq)]
#[repr(C, align(64))]
pub(crate) struct WideNode<const N: usize> {
    /// Child boxes.
    pub bounds: [[f32; N]; 6],
    /// Child references: an inner node index, a leaf reference ([`LEAF`] set) or [`EMPTY`].
    pub child: [u32; N],
}

impl<const N: usize> WideNode<N> {
    fn empty() -> Self {
        let mut bounds = [[f32::INFINITY; N]; 6];
        for axis in 0..3 {
            bounds[axis * 2 + 1] = [f32::NEG_INFINITY; N];
        }
        WideNode {
            bounds,
            child: [EMPTY; N],
        }
    }

    fn set_bounds(&mut self, slot: usize, b: &Aabb) {
        for axis in 0..3 {
            self.bounds[axis * 2][slot] = b.min[axis];
            self.bounds[axis * 2 + 1][slot] = b.max[axis];
        }
    }

    /// Box of child `slot`.
    pub fn child_bounds(&self, slot: usize) -> Aabb {
        Aabb::new(
            Vec3::new(self.bounds[0][slot], self.bounds[2][slot], self.bounds[4][slot]),
            Vec3::new(self.bounds[1][slot], self.bounds[3][slot], self.bounds[5][slot]),
        )
    }
}

/// The nodes of a wide BVH of either width.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum WideNodes {
    /// BVH4 nodes.
    Four(Vec<WideNode<4>>),
    /// BVH8 nodes.
    Eight(Vec<WideNode<8>>),
}

/// A wide BVH: nodes plus the reference of the root (which may itself be a leaf or empty).
/// What the leaves point to (triangle packets, instances) is owned by the user of the tree.
#[derive(Clone, Debug, PartialEq)]
pub struct Bvh {
    pub(crate) nodes: WideNodes,
    pub(crate) root: u32,
    depth: u32,
    leaves: u32,
}

impl Default for Bvh {
    fn default() -> Bvh {
        Bvh {
            nodes: WideNodes::Four(Vec::new()),
            root: EMPTY,
            depth: 0,
            leaves: 0,
        }
    }
}

/// Size figures of a [`Bvh`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BvhStats {
    /// Children per node.
    pub width: BvhWidth,
    /// Number of inner (wide) nodes.
    pub nodes: usize,
    /// Number of leaves.
    pub leaves: usize,
    /// Levels of inner nodes on the longest root-to-leaf path.
    pub depth: u32,
}

impl Bvh {
    /// Size figures of the tree.
    pub fn stats(&self) -> BvhStats {
        let (width, nodes) = match &self.nodes {
            WideNodes::Four(n) => (BvhWidth::Four, n.len()),
            WideNodes::Eight(n) => (BvhWidth::Eight, n.len()),
        };
        BvhStats {
            width,
            nodes,
            leaves: self.leaves as usize,
            depth: self.depth,
        }
    }

    /// Builds a wide BVH of `width` over primitives with the given boxes and centroids.
    ///
    /// `emit_leaf` receives the primitive indices of each leaf (at most `params.leaf_max`, in
    /// tree order) and returns the leaf reference to store (see [`leaf_ref`]).
    pub(crate) fn build(
        prim_bounds: &[Aabb],
        centroids: &[Vec3],
        params: BuildParams,
        width: BvhWidth,
        emit_leaf: impl FnMut(&[u32]) -> u32,
    ) -> Bvh {
        let binary = build_binary(prim_bounds, centroids, params);
        match width {
            BvhWidth::Four => collapse::<4>(&binary, emit_leaf, WideNodes::Four),
            BvhWidth::Eight => collapse::<8>(&binary, emit_leaf, WideNodes::Eight),
        }
    }
}

/// Leaf size policy of a build.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BuildParams {
    /// A node with at most this many primitives is always a leaf.
    pub leaf_target: usize,
    /// A node with more primitives than this is always split.
    pub leaf_max: usize,
}

/// A node of the intermediate binary tree.
#[derive(Clone, Copy, Debug)]
struct BinaryNode {
    bounds: Aabb,
    /// Children (inner nodes).
    left: u32,
    right: u32,
    /// Primitive range in `order` (leaves); `count == 0` for inner nodes.
    first: u32,
    count: u32,
}

/// The intermediate binary tree: nodes (root first) and the primitive order of the leaves.
struct BinaryBvh {
    nodes: Vec<BinaryNode>,
    order: Vec<u32>,
}

/// Bin of a centroid coordinate `c` for an axis starting at `lo` with `scale = BINS / extent`.
#[inline]
fn bin_of(c: f32, lo: f32, scale: f32) -> usize {
    // `as usize` saturates (negative and NaN give 0), so the result is always a valid bin.
    (((c - lo) * scale) as usize).min(BINS - 1)
}

struct Builder<'a> {
    bounds: &'a [Aabb],
    centroids: &'a [Vec3],
    params: BuildParams,
    order: Vec<u32>,
    nodes: Vec<BinaryNode>,
}

impl Builder<'_> {
    /// Box of the primitives and box of their centroids, over `order[begin..end]`.
    fn range_bounds(&self, begin: usize, end: usize) -> (Aabb, Aabb) {
        let mut bounds = Aabb::EMPTY;
        let mut centroids = Aabb::EMPTY;
        for &p in &self.order[begin..end] {
            bounds = bounds.union(self.bounds[p as usize]);
            centroids = centroids.extend(self.centroids[p as usize]);
        }
        (bounds, centroids)
    }

    /// Builds the subtree over `order[begin..end]` and returns its node index.
    fn build(&mut self, begin: usize, end: usize, depth: u32) -> u32 {
        let (bounds, centroid_bounds) = self.range_bounds(begin, end);
        let index = self.nodes.len() as u32;
        self.nodes.push(BinaryNode {
            bounds,
            left: 0,
            right: 0,
            first: begin as u32,
            count: (end - begin) as u32,
        });
        if end - begin <= self.params.leaf_target {
            return index;
        }
        let Some(mid) = self.split(begin, end, &bounds, &centroid_bounds, depth) else {
            return index;
        };
        let left = self.build(begin, mid, depth + 1);
        let right = self.build(mid, end, depth + 1);
        let node = &mut self.nodes[index as usize];
        node.left = left;
        node.right = right;
        node.count = 0;
        index
    }

    /// Chooses where to split `order[begin..end]` and partitions it; `None` makes a leaf.
    fn split(
        &mut self,
        begin: usize,
        end: usize,
        bounds: &Aabb,
        centroid_bounds: &Aabb,
        depth: u32,
    ) -> Option<usize> {
        let count = end - begin;
        let median = begin + count / 2;
        if depth >= SAH_DEPTH_LIMIT {
            return Some(median);
        }
        let Some((axis, plane, cost)) = self.best_plane(begin, end, centroid_bounds) else {
            return (count > self.params.leaf_max).then_some(median);
        };
        let area = bounds.surface_area();
        let split_cost = if area > 0.0 && area.is_finite() {
            TRAVERSAL_COST + PRIMITIVE_COST * cost / area
        } else {
            TRAVERSAL_COST
        };
        if count <= self.params.leaf_max && PRIMITIVE_COST * count as f32 <= split_cost {
            return None;
        }
        let lo = centroid_bounds.min[axis];
        let scale = BINS as f32 / (centroid_bounds.max[axis] - lo);
        // Two-pointer partition: bins `..=plane` to the left.
        let (mut i, mut j) = (begin, end);
        while i < j {
            let c = self.centroids[self.order[i] as usize][axis];
            if bin_of(c, lo, scale) <= plane {
                i += 1;
            } else {
                j -= 1;
                self.order.swap(i, j);
            }
        }
        if i == begin || i == end {
            Some(median) // Cannot happen with consistent binning; stay safe anyway.
        } else {
            Some(i)
        }
    }

    /// The cheapest binned plane `(axis, last bin on the left, SAH cost * area)`, or `None` when
    /// no axis separates the centroids.
    fn best_plane(
        &self,
        begin: usize,
        end: usize,
        centroid_bounds: &Aabb,
    ) -> Option<(usize, usize, f32)> {
        let mut counts = [[0u32; BINS]; 3];
        let mut boxes = [[Aabb::EMPTY; BINS]; 3];
        let mut scales = [0.0f32; 3];
        let mut usable = [false; 3];
        for axis in 0..3 {
            let extent = centroid_bounds.max[axis] - centroid_bounds.min[axis];
            if extent > 0.0 && extent.is_finite() {
                usable[axis] = true;
                scales[axis] = BINS as f32 / extent;
            }
        }
        if !usable.contains(&true) {
            return None;
        }
        for &p in &self.order[begin..end] {
            let c = self.centroids[p as usize];
            let b = self.bounds[p as usize];
            for axis in 0..3 {
                if usable[axis] {
                    let bin = bin_of(c[axis], centroid_bounds.min[axis], scales[axis]);
                    counts[axis][bin] += 1;
                    boxes[axis][bin] = boxes[axis][bin].union(b);
                }
            }
        }
        let mut best: Option<(usize, usize, f32)> = None;
        for axis in 0..3 {
            if !usable[axis] {
                continue;
            }
            // Right-to-left sweep: area and count of bins `plane + 1 ..`.
            let mut right_area = [0.0f32; BINS];
            let mut right_count = [0u32; BINS];
            let (mut acc, mut n) = (Aabb::EMPTY, 0u32);
            for plane in (0..BINS - 1).rev() {
                acc = acc.union(boxes[axis][plane + 1]);
                n += counts[axis][plane + 1];
                right_area[plane] = acc.surface_area();
                right_count[plane] = n;
            }
            let (mut acc, mut n) = (Aabb::EMPTY, 0u32);
            for plane in 0..BINS - 1 {
                acc = acc.union(boxes[axis][plane]);
                n += counts[axis][plane];
                if n == 0 || right_count[plane] == 0 {
                    continue;
                }
                let cost = acc.surface_area() * n as f32
                    + right_area[plane] * right_count[plane] as f32;
                if best.is_none_or(|(_, _, c)| cost < c) {
                    best = Some((axis, plane, cost));
                }
            }
        }
        best
    }
}

/// Builds the binary tree. An empty input gives an empty tree.
fn build_binary(bounds: &[Aabb], centroids: &[Vec3], params: BuildParams) -> BinaryBvh {
    let mut builder = Builder {
        bounds,
        centroids,
        params,
        order: (0..bounds.len() as u32).collect(),
        nodes: Vec::with_capacity(bounds.len().max(1) * 2 / params.leaf_target.max(1)),
    };
    if !bounds.is_empty() {
        builder.build(0, bounds.len(), 0);
    }
    BinaryBvh {
        nodes: builder.nodes,
        order: builder.order,
    }
}

struct Collapser<'a, const N: usize, F> {
    binary: &'a BinaryBvh,
    nodes: Vec<WideNode<N>>,
    emit_leaf: F,
    depth: u32,
    leaves: u32,
}

impl<const N: usize, F: FnMut(&[u32]) -> u32> Collapser<'_, N, F> {
    /// Reference to the wide subtree (or leaf) that replaces binary node `b`.
    fn reference(&mut self, b: u32, depth: u32) -> u32 {
        let node = self.binary.nodes[b as usize];
        if node.count > 0 {
            self.leaves += 1;
            let first = node.first as usize;
            return (self.emit_leaf)(&self.binary.order[first..first + node.count as usize]);
        }
        self.depth = self.depth.max(depth + 1);
        let index = self.nodes.len();
        self.nodes.push(WideNode::empty());

        let mut kids = [0u32; N];
        kids[0] = node.left;
        kids[1] = node.right;
        let mut len = 2;
        while len < N {
            // Open the inner child with the largest surface area (first one on ties).
            let mut widest: Option<(usize, f32)> = None;
            for (slot, &k) in kids[..len].iter().enumerate() {
                let kid = &self.binary.nodes[k as usize];
                if kid.count == 0 {
                    let area = kid.bounds.surface_area();
                    if widest.is_none_or(|(_, a)| area > a) {
                        widest = Some((slot, area));
                    }
                }
            }
            let Some((slot, _)) = widest else { break };
            let opened = self.binary.nodes[kids[slot] as usize];
            kids.copy_within(slot + 1..len, slot + 2);
            kids[slot] = opened.left;
            kids[slot + 1] = opened.right;
            len += 1;
        }

        let mut wide = WideNode::<N>::empty();
        for (slot, &k) in kids[..len].iter().enumerate() {
            wide.set_bounds(slot, &self.binary.nodes[k as usize].bounds);
            wide.child[slot] = self.reference(k, depth + 1);
        }
        self.nodes[index] = wide;
        index as u32
    }
}

fn collapse<const N: usize>(
    binary: &BinaryBvh,
    emit_leaf: impl FnMut(&[u32]) -> u32,
    wrap: fn(Vec<WideNode<N>>) -> WideNodes,
) -> Bvh {
    let mut collapser = Collapser::<N, _> {
        binary,
        nodes: Vec::with_capacity(binary.nodes.len() / (N - 1) + 1),
        emit_leaf,
        depth: 0,
        leaves: 0,
    };
    let root = if binary.nodes.is_empty() {
        EMPTY
    } else {
        collapser.reference(0, 0)
    };
    Bvh {
        root,
        depth: collapser.depth,
        leaves: collapser.leaves,
        nodes: wrap(collapser.nodes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    fn random_boxes(n: usize, seed: u64) -> (Vec<Aabb>, Vec<Vec3>) {
        let mut rng = Pcg32::seeded(seed, 3);
        let mut boxes = Vec::new();
        for _ in 0..n {
            let p = Vec3::new(rng.next_f32(), rng.next_f32(), rng.next_f32()) * 100.0;
            let e = Vec3::new(rng.next_f32(), rng.next_f32(), rng.next_f32()) * 3.0;
            boxes.push(Aabb::new(p, p + e));
        }
        let centroids = boxes.iter().map(Aabb::centroid).collect();
        (boxes, centroids)
    }

    const PARAMS: BuildParams = BuildParams {
        leaf_target: 4,
        leaf_max: 8,
    };

    /// Builds a tree whose leaves record their primitive lists; returns it with the lists.
    fn build(boxes: &[Aabb], centroids: &[Vec3], width: BvhWidth) -> (Bvh, Vec<Vec<u32>>) {
        let mut leaves = Vec::new();
        let bvh = Bvh::build(boxes, centroids, PARAMS, width, |prims| {
            leaves.push(prims.to_vec());
            leaf_ref(leaves.len() - 1, 1)
        });
        (bvh, leaves)
    }

    /// Checks containment recursively and returns the primitives below `reference`.
    fn check<const N: usize>(
        nodes: &[WideNode<N>],
        reference: u32,
        parent: &Aabb,
        boxes: &[Aabb],
        leaves: &[Vec<u32>],
        seen: &mut Vec<u32>,
    ) {
        let inside = |b: &Aabb| {
            b.min.x >= parent.min.x
                && b.min.y >= parent.min.y
                && b.min.z >= parent.min.z
                && b.max.x <= parent.max.x
                && b.max.y <= parent.max.y
                && b.max.z <= parent.max.z
        };
        if reference & LEAF != 0 {
            let (first, _) = leaf_range(reference);
            for &p in &leaves[first] {
                assert!(inside(&boxes[p as usize]), "primitive {p} outside its leaf box");
                seen.push(p);
            }
            return;
        }
        let node = &nodes[reference as usize];
        for slot in 0..N {
            let child = node.child[slot];
            if child == EMPTY {
                assert!(node.child_bounds(slot).is_empty());
                continue;
            }
            let b = node.child_bounds(slot);
            assert!(inside(&b), "child box outside its parent");
            check(nodes, child, &b, boxes, leaves, seen);
        }
    }

    #[test]
    fn wide_nodes_contain_their_children_and_every_primitive_once() {
        let (boxes, centroids) = random_boxes(3000, 1);
        for width in [BvhWidth::Four, BvhWidth::Eight] {
            let (bvh, leaves) = build(&boxes, &centroids, width);
            let everything = boxes.iter().fold(Aabb::EMPTY, |a, b| a.union(*b));
            let mut seen = Vec::new();
            match &bvh.nodes {
                WideNodes::Four(n) => check(n, bvh.root, &everything, &boxes, &leaves, &mut seen),
                WideNodes::Eight(n) => check(n, bvh.root, &everything, &boxes, &leaves, &mut seen),
            }
            seen.sort_unstable();
            assert_eq!(seen, (0..3000).collect::<Vec<u32>>());
            assert!(leaves.iter().all(|l| !l.is_empty() && l.len() <= 8));
            let stats = bvh.stats();
            assert_eq!(stats.width, width);
            assert_eq!(stats.leaves, leaves.len());
            assert!(stats.depth >= 3 && stats.depth < 20, "{stats:?}");
        }
    }

    #[test]
    fn builds_are_deterministic() {
        let (boxes, centroids) = random_boxes(2000, 2);
        for width in [BvhWidth::Four, BvhWidth::Eight] {
            let a = build(&boxes, &centroids, width);
            let b = build(&boxes, &centroids, width);
            assert_eq!(a, b);
        }
    }

    #[test]
    fn identical_primitives_are_split_at_the_median() {
        let boxes = vec![Aabb::new(Vec3::ZERO, Vec3::ONE); 1000];
        let centroids = vec![Vec3::splat(0.5); 1000];
        let (bvh, leaves) = build(&boxes, &centroids, BvhWidth::Four);
        assert!(leaves.iter().all(|l| l.len() <= 8));
        assert_eq!(leaves.iter().map(Vec::len).sum::<usize>(), 1000);
        assert!(bvh.stats().depth <= SAH_DEPTH_LIMIT + 10);
    }

    #[test]
    fn small_and_empty_inputs() {
        let (bvh, leaves) = build(&[], &[], BvhWidth::Eight);
        assert_eq!(bvh.root, EMPTY);
        assert!(leaves.is_empty());
        let (boxes, centroids) = random_boxes(3, 4);
        let (bvh, leaves) = build(&boxes, &centroids, BvhWidth::Four);
        assert_ne!(bvh.root & LEAF, 0, "three primitives fit in one leaf");
        assert_eq!(leaves, [vec![0, 1, 2]]);
        assert_eq!(bvh.stats().nodes, 0);
    }

    #[test]
    fn leaf_references_round_trip() {
        for (first, count) in [(0, 1), (5, 8), (MAX_LEAF_FIRST, 8), (123_456, 3)] {
            let r = leaf_ref(first, count);
            assert_ne!(r & LEAF, 0);
            assert_ne!(r, EMPTY);
            assert_eq!(leaf_range(r), (first, count));
        }
    }
}

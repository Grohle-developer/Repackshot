//! The traversal kernels: two-level (instances, then meshes) wide-BVH traversal with an explicit
//! stack, generic over a SIMD [`Backend`] and entered once per query through
//! [`crate::simd::Isa::dispatch`].
//!
//! Everything here is `#[inline(always)]` so that a whole query is compiled inside the
//! target-feature function of the dispatched path (see the `simd` module).
//!
//! **Slab test.** The near and far planes of each axis are chosen by the sign of the ray
//! direction (no per-lane min/max), and NaNs from `0 * inf` (a ray parallel to a slab and lying
//! on its boundary) are dropped by putting them first in [`Vector::max`]/[`Vector::min`], so such
//! an axis imposes no constraint. The far distance is scaled by `1 + 4 * f32::EPSILON`, which
//! covers the rounding of the test (T. Ize, *"Robust BVH Ray Traversal"*, JCGT 2(2), 2013) and
//! keeps boxes whose entry distance ties with the best hit so far.
//!
//! **Nearest hit.** The answer is the hit with the smallest `(t, instance, triangle)`, compared
//! lexicographically. Because the order is total and the triangle test gives the same bits on
//! every path, the result does not depend on the tree, its width or the traversal order: the BVH
//! returns exactly what a brute-force loop over every triangle returns.
//!
//! **Particles** (S4a). Each particle set is one more entry of the top level, walked after the
//! instance BVH: its own flat BVH in world space, one particle per leaf ([`ParticleSet`]), with
//! the nearest part found so far as the end of the search (the particles behind the part are never
//! visited; an any-hit query that a part already answered does not look at them). A camera ray of
//! a pinhole camera tests the particles of its cell of the set's screen grid instead (S4b,
//! [`ParticleSet`]): a superset of the leaves it would visit. A hit offers
//! `(t, instance of the set, particle id)` to the same order, so the same exactness holds. The
//! [`RayClass`] of the query says which sets it sees.

use super::bvh::{leaf_range, WideNode, WideNodes, EMPTY, LEAF};
use super::mesh::Mesh;
use super::particles::ParticleSet;
use super::triangle::{packet_hits, Cull, PreparedRay, RayLanes, TriPacket};
use super::{Geometry, RayClass, RayHit};
use crate::math::Ray;
use crate::simd::{Backend, Kernel, Mask, Vector};
use std::marker::PhantomData;

/// Scale applied to the far distance of the slab test (see the module documentation).
const ROBUST_SCALE: f32 = 1.0 + 4.0 * f32::EPSILON;

/// Entries of the traversal stack kept inline; deeper (degenerate) trees spill to the heap.
const INLINE_STACK: usize = 64;

/// The traversal stack: `(child reference, entry distance)` pairs. Shared by the instance
/// level and the mesh level of one query. The first [`INLINE_STACK`] entries live inline, the
/// rest (only deep, degenerate trees get there) in `spill`.
pub(crate) struct Stack {
    entries: [u64; INLINE_STACK],
    /// Total height: `entries[..min(len, INLINE_STACK)]` then `spill`.
    len: usize,
    spill: Vec<u64>,
}

impl Stack {
    #[inline(always)]
    pub fn new() -> Stack {
        Stack {
            entries: [0; INLINE_STACK],
            len: 0,
            spill: Vec::new(),
        }
    }

    #[inline(always)]
    fn height(&self) -> usize {
        self.len
    }

    #[inline(always)]
    fn push(&mut self, entry: u64) {
        if let Some(slot) = self.entries.get_mut(self.len) {
            *slot = entry;
        } else {
            self.spill.push(entry);
        }
        self.len += 1;
    }

    #[inline(always)]
    fn pop(&mut self) -> Option<u64> {
        self.len = self.len.checked_sub(1)?;
        match self.entries.get(self.len) {
            Some(&entry) => Some(entry),
            None => self.spill.pop(),
        }
    }

    #[inline(always)]
    fn truncate(&mut self, height: usize) {
        if self.len > height {
            self.len = height;
            self.spill.truncate(height.saturating_sub(INLINE_STACK));
        }
    }
}

/// A stack entry: the entry distance in the high half (as bits: for the non-negative distances
/// of rays with `t_min >= 0`, integer order is float order), the child reference in the low half.
#[inline(always)]
fn entry(t: f32, reference: u32) -> u64 {
    (u64::from(t.to_bits()) << 32) | u64::from(reference)
}

/// `(child reference, entry distance)` of a stack entry.
#[inline(always)]
fn unpack(entry: u64) -> (u32, f32) {
    (entry as u32, f32::from_bits((entry >> 32) as u32))
}

/// The nearest hit found so far.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Best {
    pub t: f32,
    pub instance: u32,
    pub triangle: u32,
}

impl Best {
    #[inline(always)]
    pub fn new(t_max: f32) -> Best {
        Best {
            t: t_max,
            instance: u32::MAX,
            triangle: u32::MAX,
        }
    }

    /// Keeps the hit if it is nearer, or as near and with a smaller `(instance, triangle)`.
    #[inline(always)]
    pub fn offer(&mut self, t: f32, instance: u32, triangle: u32) {
        if t < self.t || (t == self.t && (instance, triangle) < (self.instance, self.triangle)) {
            *self = Best {
                t,
                instance,
                triangle,
            };
        }
    }

    #[inline(always)]
    pub fn hit(self) -> Option<RayHit> {
        (self.instance != u32::MAX).then_some(RayHit {
            instance: self.instance,
            triangle: self.triangle,
            t: self.t,
        })
    }
}

/// A ray splatted for the slab test of `V::LANES` children.
struct BoxLanes<V> {
    org: [V; 3],
    inv: [V; 3],
    negative: [bool; 3],
    t_min: V,
    /// Per axis, what moves the near plane of a box outwards by the padding (`-pad` for a min
    /// plane, `+pad` for a max plane); the far plane moves by the opposite. Zero unless padded.
    near_pad: [V; 3],
}

impl<V: Vector> BoxLanes<V> {
    #[inline(always)]
    fn new(r: &PreparedRay) -> Self {
        BoxLanes::padded(r, 0.0)
    }

    /// The lanes for boxes grown by `pad` on every side (the particles a camera ray sees widened).
    #[inline(always)]
    fn padded(r: &PreparedRay, pad: f32) -> Self {
        let near = |negative: bool| V::splat(if negative { pad } else { -pad });
        BoxLanes {
            org: [V::splat(r.org[0]), V::splat(r.org[1]), V::splat(r.org[2])],
            inv: [V::splat(r.inv[0]), V::splat(r.inv[1]), V::splat(r.inv[2])],
            negative: r.negative,
            t_min: V::splat(r.t_min),
            near_pad: r.negative.map(near),
        }
    }
}

/// Slab test of every child of `node`: the bit mask of children hit within `[t_min, t_max]` and
/// their entry distances. With `PAD` the boxes are grown by the padding of `r` first.
#[inline(always)]
fn node_test<V, const N: usize, const PAD: bool>(
    node: &WideNode<N>,
    r: &BoxLanes<V>,
    t_max: f32,
) -> (u32, [f32; N])
where
    V: Vector<Array = [f32; N]>,
{
    let [ox, oy, oz] = r.org;
    let [ix, iy, iz] = r.inv;
    let [bx, by, bz] = &node.bounds;
    // `bool as usize` is 0 or 1: indexing the [min, max] pair needs no bounds check.
    let [nx, ny, nz] = r.negative.map(usize::from);
    let (mut lx0, mut ly0, mut lz0) = (V::load(&bx[nx]), V::load(&by[ny]), V::load(&bz[nz]));
    let (mut lx1, mut ly1, mut lz1) = (
        V::load(&bx[1 - nx]),
        V::load(&by[1 - ny]),
        V::load(&bz[1 - nz]),
    );
    if PAD {
        let [px, py, pz] = r.near_pad;
        lx0 = lx0 + px;
        ly0 = ly0 + py;
        lz0 = lz0 + pz;
        lx1 = lx1 - px;
        ly1 = ly1 - py;
        lz1 = lz1 - pz;
    }
    let tx0 = (lx0 - ox) * ix;
    let ty0 = (ly0 - oy) * iy;
    let tz0 = (lz0 - oz) * iz;
    let tx1 = (lx1 - ox) * ix;
    let ty1 = (ly1 - oy) * iy;
    let tz1 = (lz1 - oz) * iz;
    // NaN operands come first so that `max`/`min` drop them.
    let near = tz0.max(ty0.max(tx0.max(r.t_min)));
    let far = tz1.min(ty1.min(tx1.min(V::splat(t_max)))) * V::splat(ROBUST_SCALE);
    (near.le(far).bitmask(), near.to_array())
}

/// Pushes the children in `bits` farthest first and returns the nearest one.
#[inline(always)]
fn push_ordered<const N: usize>(
    node: &WideNode<N>,
    mut bits: u32,
    near: &[f32; N],
    stack: &mut Stack,
) -> u32 {
    if bits & (bits - 1) == 0 {
        return node.child[bits.trailing_zeros() as usize];
    }
    // Insertion sort of the packed entries by decreasing distance; at most N of them. (Only the
    // order of the visit depends on it, never the result.)
    let mut keys = [0u64; N];
    let mut count = 0;
    while bits != 0 {
        let slot = bits.trailing_zeros() as usize;
        bits &= bits - 1;
        let key = entry(near[slot], node.child[slot]);
        let mut j = count;
        while j > 0 && keys[j - 1] < key {
            keys[j] = keys[j - 1];
            j -= 1;
        }
        keys[j] = key;
        count += 1;
    }
    for &key in &keys[..count - 1] {
        stack.push(key);
    }
    unpack(keys[count - 1]).0
}

/// Pushes every child in `bits` but the first and returns the first (any-hit order).
#[inline(always)]
fn push_any<const N: usize>(
    node: &WideNode<N>,
    mut bits: u32,
    near: &[f32; N],
    stack: &mut Stack,
) -> u32 {
    let first = bits.trailing_zeros() as usize;
    bits &= bits - 1;
    while bits != 0 {
        let slot = bits.trailing_zeros() as usize;
        bits &= bits - 1;
        stack.push(entry(near[slot], node.child[slot]));
    }
    node.child[first]
}

/// What a traversal does at its leaves.
trait Leaves {
    /// End of the search interval: the best hit so far, or the ray's `t_max`.
    fn t_max(&self) -> f32;
    /// Processes a leaf; returns true to stop the traversal (an any-hit query found one).
    fn leaf(&mut self, reference: u32, stack: &mut Stack) -> bool;
}

/// Walks the tree from `root`. `ordered` visits children nearest first (closest hit);
/// otherwise in slot order (any hit). Returns true when a leaf stopped the walk.
#[inline(always)]
fn walk<V, const N: usize, L: Leaves>(
    nodes: &[WideNode<N>],
    root: u32,
    ray: &BoxLanes<V>,
    ordered: bool,
    leaves: &mut L,
    stack: &mut Stack,
) -> bool
where
    V: Vector<Array = [f32; N]>,
{
    walk_with::<V, N, L, false>(nodes, root, ray, ordered, leaves, stack)
}

/// [`walk`] with every box grown by the padding of `ray` when `PAD` is set.
#[inline(always)]
fn walk_with<V, const N: usize, L: Leaves, const PAD: bool>(
    nodes: &[WideNode<N>],
    root: u32,
    ray: &BoxLanes<V>,
    ordered: bool,
    leaves: &mut L,
    stack: &mut Stack,
) -> bool
where
    V: Vector<Array = [f32; N]>,
{
    let base = stack.height();
    let mut current = root;
    loop {
        if current & LEAF == 0 {
            if let Some(node) = nodes.get(current as usize) {
                let (bits, near) = node_test::<V, N, PAD>(node, ray, leaves.t_max());
                if bits != 0 {
                    current = if ordered {
                        push_ordered(node, bits, &near, stack)
                    } else {
                        push_any(node, bits, &near, stack)
                    };
                    continue;
                }
            }
        } else if current != EMPTY && leaves.leaf(current, stack) {
            stack.truncate(base);
            return true;
        }
        // Next subtree that may still hold a nearer hit.
        loop {
            if stack.height() <= base {
                return false;
            }
            let Some((reference, t)) = stack.pop().map(unpack) else {
                return false;
            };
            if t <= leaves.t_max() * ROBUST_SCALE {
                current = reference;
                break;
            }
        }
    }
}

/// Mesh leaves for the nearest hit.
struct NearestTriangles<'a, V> {
    packets: &'a [TriPacket],
    lanes: RayLanes<V>,
    cull: Cull,
    instance: u32,
    best: &'a mut Best,
}

impl<V: Vector<Array = [f32; 4]>> Leaves for NearestTriangles<'_, V> {
    #[inline(always)]
    fn t_max(&self) -> f32 {
        self.best.t
    }

    #[inline(always)]
    fn leaf(&mut self, reference: u32, _: &mut Stack) -> bool {
        let (first, count) = leaf_range(reference);
        let Some(packets) = self.packets.get(first..first + count) else {
            return false;
        };
        for p in packets {
            let (mut bits, t) = packet_hits(&self.lanes, p, self.best.t, self.cull);
            while bits != 0 {
                let lane = bits.trailing_zeros() as usize;
                bits &= bits - 1;
                self.best.offer(t[lane], self.instance, p.id[lane]);
            }
        }
        false
    }
}

/// Mesh leaves for any hit.
struct AnyTriangle<'a, V> {
    packets: &'a [TriPacket],
    lanes: RayLanes<V>,
    cull: Cull,
    t_max: f32,
}

impl<V: Vector<Array = [f32; 4]>> Leaves for AnyTriangle<'_, V> {
    #[inline(always)]
    fn t_max(&self) -> f32 {
        self.t_max
    }

    #[inline(always)]
    fn leaf(&mut self, reference: u32, _: &mut Stack) -> bool {
        let (first, count) = leaf_range(reference);
        let Some(packets) = self.packets.get(first..first + count) else {
            return false;
        };
        // Plain loops, no closures: everything must inline into the dispatched kernel.
        for p in packets {
            if packet_hits(&self.lanes, p, self.t_max, self.cull).0 != 0 {
                return true;
            }
        }
        false
    }
}

/// Nearest hit of a mesh, folded into `best`.
#[inline(always)]
fn mesh_nearest<B: Backend>(
    mesh: &Mesh,
    r: &PreparedRay,
    cull: Cull,
    instance: u32,
    best: &mut Best,
    stack: &mut Stack,
) {
    let (bvh, packets) = mesh.accel();
    let mut leaves = NearestTriangles {
        packets,
        lanes: RayLanes::<B::V4>::new(r),
        cull,
        instance,
        best,
    };
    match &bvh.nodes {
        WideNodes::Four(nodes) => {
            walk(
                nodes,
                bvh.root,
                &BoxLanes::<B::V4>::new(r),
                true,
                &mut leaves,
                stack,
            );
        }
        WideNodes::Eight(nodes) => {
            walk(
                nodes,
                bvh.root,
                &BoxLanes::<B::V8>::new(r),
                true,
                &mut leaves,
                stack,
            );
        }
    }
}

/// Whether a mesh has any hit in `[r.t_min, r.t_max]`.
#[inline(always)]
fn mesh_any<B: Backend>(mesh: &Mesh, r: &PreparedRay, cull: Cull, stack: &mut Stack) -> bool {
    let (bvh, packets) = mesh.accel();
    let mut leaves = AnyTriangle {
        packets,
        lanes: RayLanes::<B::V4>::new(r),
        cull,
        t_max: r.t_max,
    };
    match &bvh.nodes {
        WideNodes::Four(nodes) => walk(
            nodes,
            bvh.root,
            &BoxLanes::<B::V4>::new(r),
            false,
            &mut leaves,
            stack,
        ),
        WideNodes::Eight(nodes) => walk(
            nodes,
            bvh.root,
            &BoxLanes::<B::V8>::new(r),
            false,
            &mut leaves,
            stack,
        ),
    }
}

/// Particle leaves for the nearest hit.
struct NearestParticles<'a> {
    set: &'a ParticleSet,
    ray: &'a Ray,
    t_min: f32,
    camera: bool,
    instance: u32,
    best: &'a mut Best,
}

impl Leaves for NearestParticles<'_> {
    #[inline(always)]
    fn t_max(&self) -> f32 {
        self.best.t
    }

    #[inline(always)]
    fn leaf(&mut self, reference: u32, _: &mut Stack) -> bool {
        for slot in self.set.leaf(reference) {
            if let Some(t) = self
                .set
                .hit(slot, self.ray, self.t_min, self.best.t, self.camera)
            {
                self.best.offer(t, self.instance, self.set.id(slot));
            }
        }
        false
    }
}

/// Particle leaves for any hit.
struct AnyParticle<'a> {
    set: &'a ParticleSet,
    ray: &'a Ray,
    t_min: f32,
    t_max: f32,
    camera: bool,
}

impl Leaves for AnyParticle<'_> {
    #[inline(always)]
    fn t_max(&self) -> f32 {
        self.t_max
    }

    #[inline(always)]
    fn leaf(&mut self, reference: u32, _: &mut Stack) -> bool {
        for slot in self.set.leaf(reference) {
            if self
                .set
                .hit(slot, self.ray, self.t_min, self.t_max, self.camera)
                .is_some()
            {
                return true;
            }
        }
        false
    }
}

/// Walks a particle set's BVH with `leaves` (in world space: `r` is the prepared world ray). For a
/// camera ray the boxes (of the particles' real sizes) are grown by the set's camera padding, the
/// most any of its particles is widened to the minimum size on screen.
#[inline(always)]
fn walk_particles<B: Backend, L: Leaves>(
    set: &ParticleSet,
    r: &PreparedRay,
    ordered: bool,
    camera: bool,
    leaves: &mut L,
    stack: &mut Stack,
) -> bool {
    let bvh = set.bvh();
    let pad = if camera { set.camera_pad() } else { 0.0 };
    match (&bvh.nodes, pad > 0.0) {
        (WideNodes::Four(nodes), false) => walk(
            nodes,
            bvh.root,
            &BoxLanes::<B::V4>::new(r),
            ordered,
            leaves,
            stack,
        ),
        (WideNodes::Eight(nodes), false) => walk(
            nodes,
            bvh.root,
            &BoxLanes::<B::V8>::new(r),
            ordered,
            leaves,
            stack,
        ),
        (WideNodes::Four(nodes), true) => walk_with::<_, 4, _, true>(
            nodes,
            bvh.root,
            &BoxLanes::<B::V4>::padded(r, pad),
            ordered,
            leaves,
            stack,
        ),
        (WideNodes::Eight(nodes), true) => walk_with::<_, 8, _, true>(
            nodes,
            bvh.root,
            &BoxLanes::<B::V8>::padded(r, pad),
            ordered,
            leaves,
            stack,
        ),
    }
}

/// Instance leaves for the nearest hit: each instance moves the ray into its mesh's space; a
/// particle set the query sees is walked in world space.
struct NearestInstances<'a, B> {
    geometry: &'a Geometry,
    ray: &'a Ray,
    world: PreparedRay,
    best: Best,
    backend: PhantomData<B>,
}

impl<B: Backend> Leaves for NearestInstances<'_, B> {
    #[inline(always)]
    fn t_max(&self) -> f32 {
        self.best.t
    }

    #[inline(always)]
    fn leaf(&mut self, reference: u32, stack: &mut Stack) -> bool {
        let (first, count) = leaf_range(reference);
        for slot in first..first + count {
            let Some((instance, mesh, prepared)) = self.geometry.tlas_instance(slot) else {
                continue;
            };
            let local = prepared.prepare(self.ray, &self.world);
            mesh_nearest::<B>(mesh, &local, prepared.cull, instance, &mut self.best, stack);
        }
        false
    }
}

/// Instance leaves for any hit.
struct AnyInstance<'a, B> {
    geometry: &'a Geometry,
    ray: &'a Ray,
    world: PreparedRay,
    t_max: f32,
    backend: PhantomData<B>,
}

impl<B: Backend> Leaves for AnyInstance<'_, B> {
    #[inline(always)]
    fn t_max(&self) -> f32 {
        self.t_max
    }

    #[inline(always)]
    fn leaf(&mut self, reference: u32, stack: &mut Stack) -> bool {
        let (first, count) = leaf_range(reference);
        for slot in first..first + count {
            if let Some((_, mesh, prepared)) = self.geometry.tlas_instance(slot) {
                let local = prepared.prepare(self.ray, &self.world);
                if mesh_any::<B>(mesh, &local, prepared.cull, stack) {
                    return true;
                }
            }
        }
        false
    }
}

/// The nearest hit of `ray` in `geometry`.
#[inline(always)]
fn nearest<B: Backend>(
    geometry: &Geometry,
    ray: &Ray,
    class: RayClass,
    stack: &mut Stack,
) -> Option<RayHit> {
    let r = PreparedRay::new(ray);
    if !r.has_interval() {
        return None;
    }
    let mut leaves = NearestInstances::<B> {
        geometry,
        ray,
        world: r,
        best: Best::new(r.t_max),
        backend: PhantomData,
    };
    let tlas = geometry.tlas();
    match &tlas.nodes {
        WideNodes::Four(nodes) => {
            walk(
                nodes,
                tlas.root,
                &BoxLanes::<B::V4>::new(&r),
                true,
                &mut leaves,
                stack,
            );
        }
        WideNodes::Eight(nodes) => {
            walk(
                nodes,
                tlas.root,
                &BoxLanes::<B::V8>::new(&r),
                true,
                &mut leaves,
                stack,
            );
        }
    }
    // The particle sets after the parts: the nearest part bounds the search, so the particles
    // behind it are never visited.
    let mut best = leaves.best;
    let first_set = geometry.instances().len() as u32;
    for (k, set) in geometry.particle_sets().iter().enumerate() {
        if set.is_empty() || !class.sees(set) {
            continue;
        }
        let camera = class == RayClass::Camera;
        let instance = first_set + k as u32;
        // A camera ray from the pinhole's centre tests the particles of its cell of the screen
        // grid (S4b): the same tests, so the same nearest hit.
        if let Some((cell, everywhere)) = camera.then(|| set.screen_candidates(ray)).flatten() {
            for &slot in cell.iter().chain(everywhere) {
                let slot = slot as usize;
                if let Some(t) = set.hit(slot, ray, r.t_min, best.t, true) {
                    best.offer(t, instance, set.id(slot));
                }
            }
            continue;
        }
        let mut leaves = NearestParticles {
            set,
            ray,
            t_min: r.t_min,
            camera,
            instance,
            best: &mut best,
        };
        walk_particles::<B, _>(set, &r, true, camera, &mut leaves, stack);
    }
    best.hit()
}

/// Whether `ray` hits anything in `[t_min, t_max]`.
#[inline(always)]
fn any<B: Backend>(geometry: &Geometry, ray: &Ray, class: RayClass, stack: &mut Stack) -> bool {
    let r = PreparedRay::new(ray);
    if !r.has_interval() {
        return false;
    }
    let mut leaves = AnyInstance::<B> {
        geometry,
        ray,
        world: r,
        t_max: r.t_max,
        backend: PhantomData,
    };
    let tlas = geometry.tlas();
    let parts = match &tlas.nodes {
        WideNodes::Four(nodes) => walk(
            nodes,
            tlas.root,
            &BoxLanes::<B::V4>::new(&r),
            false,
            &mut leaves,
            stack,
        ),
        WideNodes::Eight(nodes) => walk(
            nodes,
            tlas.root,
            &BoxLanes::<B::V8>::new(&r),
            false,
            &mut leaves,
            stack,
        ),
    };
    if parts {
        return true;
    }
    // The particle sets only when no part is in the way. Plain loops, no closures: everything
    // must inline into the dispatched kernel.
    for set in geometry.particle_sets() {
        if set.is_empty() || !class.sees(set) {
            continue;
        }
        let mut leaves = AnyParticle {
            set,
            ray,
            t_min: r.t_min,
            t_max: r.t_max,
            camera: class == RayClass::Camera,
        };
        if walk_particles::<B, _>(
            set,
            &r,
            false,
            class == RayClass::Camera,
            &mut leaves,
            stack,
        ) {
            return true;
        }
    }
    false
}

/// Kernel: nearest hit of one ray.
pub(crate) struct NearestKernel<'a> {
    pub geometry: &'a Geometry,
    pub ray: &'a Ray,
    pub class: RayClass,
}

impl Kernel for NearestKernel<'_> {
    type Output = Option<RayHit>;

    #[inline(always)]
    fn run<B: Backend>(self) -> Option<RayHit> {
        nearest::<B>(self.geometry, self.ray, self.class, &mut Stack::new())
    }
}

/// Kernel: nearest hits of many rays (one dispatch for the batch).
pub(crate) struct NearestBatchKernel<'a> {
    pub geometry: &'a Geometry,
    pub rays: &'a [Ray],
    pub out: &'a mut [Option<RayHit>],
    pub class: RayClass,
}

impl Kernel for NearestBatchKernel<'_> {
    type Output = ();

    #[inline(always)]
    fn run<B: Backend>(self) {
        let mut stack = Stack::new();
        for (ray, out) in self.rays.iter().zip(self.out.iter_mut()) {
            *out = if super::usable(ray) {
                nearest::<B>(self.geometry, ray, self.class, &mut stack)
            } else {
                None
            };
        }
    }
}

/// Kernel: whether one ray hits anything.
pub(crate) struct AnyKernel<'a> {
    pub geometry: &'a Geometry,
    pub ray: &'a Ray,
    pub class: RayClass,
}

impl Kernel for AnyKernel<'_> {
    type Output = bool;

    #[inline(always)]
    fn run<B: Backend>(self) -> bool {
        any::<B>(self.geometry, self.ray, self.class, &mut Stack::new())
    }
}

/// Kernel: whether each of many rays hits anything (one dispatch for the batch).
pub(crate) struct AnyBatchKernel<'a> {
    pub geometry: &'a Geometry,
    pub rays: &'a [Ray],
    pub out: &'a mut [bool],
    pub class: RayClass,
}

impl Kernel for AnyBatchKernel<'_> {
    type Output = ();

    #[inline(always)]
    fn run<B: Backend>(self) {
        let mut stack = Stack::new();
        for (ray, out) in self.rays.iter().zip(self.out.iter_mut()) {
            *out = super::usable(ray) && any::<B>(self.geometry, ray, self.class, &mut stack);
        }
    }
}

/// The reference the BVH is tested against: every triangle of every instance and every particle
/// the class sees, in order, with the same scalar tests and the same tie-break.
#[cfg(test)]
pub(crate) fn brute_force(
    geometry: &Geometry,
    ray: &Ray,
    class: RayClass,
) -> (Option<RayHit>, bool) {
    use super::triangle::watertight;
    let r = PreparedRay::new(ray);
    if !super::usable(ray) || !r.has_interval() {
        return (None, false);
    }
    let mut best = Best::new(r.t_max);
    let mut any = false;
    for instance in 0..geometry.instances().len() as u32 {
        let Some((mesh, prepared)) = geometry.instance_parts(instance) else {
            continue;
        };
        let local = PreparedRay::new(&prepared.local_ray(ray));
        for triangle in 0..mesh.triangle_count() {
            let Some([a, b, c]) = mesh.triangle(triangle) else {
                continue;
            };
            any |= watertight(&local, a, b, c, local.t_max, prepared.cull).is_some();
            if let Some(h) = watertight(&local, a, b, c, best.t, prepared.cull) {
                best.offer(h.t, instance, triangle as u32);
            }
        }
    }
    let first_set = geometry.instances().len() as u32;
    for (k, set) in geometry.particle_sets().iter().enumerate() {
        if !class.sees(set) {
            continue;
        }
        let camera = class == RayClass::Camera;
        for slot in 0..set.len() {
            any |= set.hit(slot, ray, r.t_min, r.t_max, camera).is_some();
            if let Some(t) = set.hit(slot, ray, r.t_min, best.t, camera) {
                best.offer(t, first_set + k as u32, set.id(slot));
            }
        }
    }
    (best.hit(), any)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stack_spills_and_stays_last_in_first_out() {
        let mut stack = Stack::new();
        for i in 0..200u32 {
            stack.push(entry(i as f32 * 0.5, i));
        }
        assert_eq!(stack.height(), 200);
        for i in (100..200u32).rev() {
            assert_eq!(stack.pop().map(unpack), Some((i, i as f32 * 0.5)));
        }
        stack.push(entry(1.0, 7));
        assert_eq!(stack.pop().map(unpack), Some((7, 1.0)));
        stack.truncate(70);
        assert_eq!(stack.height(), 70);
        stack.push(entry(2.0, 1000));
        assert_eq!(stack.pop().map(unpack), Some((1000, 2.0)));
        assert_eq!(stack.pop().map(unpack), Some((69, 34.5)));
        stack.truncate(10);
        assert_eq!(stack.height(), 10);
        for i in (0..10u32).rev() {
            assert_eq!(stack.pop().map(unpack), Some((i, i as f32 * 0.5)));
        }
        assert_eq!(stack.pop(), None);
        // Packed entries order like their distances.
        assert!(entry(1.5, 9) > entry(1.25, 100) && entry(0.0, 5) < entry(1.0e-30, 0));
    }

    #[test]
    fn ties_go_to_the_smallest_instance_then_triangle() {
        let mut best = Best::new(10.0);
        best.offer(5.0, 3, 9);
        best.offer(5.0, 3, 2);
        best.offer(5.0, 4, 0);
        best.offer(6.0, 0, 0);
        assert_eq!((best.t, best.instance, best.triangle), (5.0, 3, 2));
        best.offer(5.0, 1, 50);
        assert_eq!((best.instance, best.triangle), (1, 50));
        assert!(Best::new(1.0).hit().is_none());
    }
}

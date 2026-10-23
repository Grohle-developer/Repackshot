//! Nested dielectrics by priority (S7): C. M. Schmidt and B. Budge, "Simple Nested Dielectrics
//! in Ray Traced Images", Journal of Graphics Tools 7(2), 2002, written from the paper.
//!
//! A path keeps the list of the clear solids it is inside (its *interior list*). Each material has
//! a priority (`NEST`, [`crate::scene::Scene::priorities`]); where solids overlap, the inside is
//! the one of highest priority (of equal ones, the one entered last). A surface the path meets is
//! a **false** hit when it does not change that: entering a solid of lower priority than the one
//! it is in, or leaving one that is not the one it is in. The path crosses a false hit straight
//! (the list notes the solid, or forgets it) and the surface is not there for it. At a **true**
//! hit the relative index is that of the two media on either side: the solid's own index over the
//! index of the medium the path is in, entering, and the index of the medium it goes into (the
//! next one of the list) over the solid's, leaving. So a liquid modelled overlapping its glass's
//! wall, of lower priority than the glass, refracts at the liquid/glass ratio where they touch,
//! and the overlap is glass.
//!
//! A scene where no material has a priority above 0 does not use any of this: every path is
//! traced exactly as before, bit for bit. In a scene that does, a solid of priority 0 is the
//! lowest; and a path that meets solids that do not overlap gets the same numbers as the plain
//! rule (entering from the air the relative index is the solid's own, `n / 1`, leaving it is
//! `1 / n`).

/// Most solids a path is inside at once (beyond, the newest is not noted: it is treated as the
/// air would be).
pub const MAX_NESTED: usize = 8;

/// Most false hits a path crosses (a guard against meshes that never let it out).
pub const MAX_FALSE_HITS: u32 = 64;

/// A relative index this close to one is no interface at all: the path crosses it straight.
pub const MATCHED: f32 = 1.0e-4;

/// A solid the path is inside.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Entry {
    /// The instance whose solid it is.
    pub instance: u32,
    /// Its material's priority.
    pub priority: u32,
    /// Its material's index of refraction.
    pub ior: f32,
}

/// What a surface of a clear solid is to a path.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Crossing {
    /// It does not change the medium the path is in: crossed straight.
    False,
    /// A true interface, with the index of refraction of the medium on its other side.
    True {
        /// The index beyond the surface (entering: of the medium the path is in; leaving: of the
        /// medium it goes into), 1 for the air.
        other: f32,
    },
}

/// The solids a path is inside, in the order it entered them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Interior {
    entries: [Entry; MAX_NESTED],
    len: usize,
}

impl Default for Interior {
    fn default() -> Interior {
        Interior {
            entries: [Entry {
                instance: u32::MAX,
                priority: 0,
                ior: 1.0,
            }; MAX_NESTED],
            len: 0,
        }
    }
}

impl Interior {
    /// The solids in the list.
    pub fn entries(&self) -> &[Entry] {
        &self.entries[..self.len]
    }

    /// Where the solid of highest priority is in the list (of equal ones, the last entered).
    fn top_at(&self) -> Option<usize> {
        let mut best: Option<usize> = None;
        for (k, e) in self.entries().iter().enumerate() {
            if best.is_none_or(|b| e.priority >= self.entries[b].priority) {
                best = Some(k);
            }
        }
        best
    }

    /// The solid the path is in: the one of highest priority.
    pub fn top(&self) -> Option<Entry> {
        self.top_at().map(|k| self.entries[k])
    }

    fn find(&self, instance: u32) -> Option<usize> {
        self.entries().iter().rposition(|e| e.instance == instance)
    }

    /// What a surface of `solid` is to the path, entering it or leaving it.
    pub fn crossing(&self, solid: Entry, entering: bool) -> Crossing {
        let top = self.top();
        if entering {
            match top {
                // Into a solid of lower priority than the one the path is in, or one it is
                // already inside (a mesh that overlaps itself): nothing changes.
                Some(t) if solid.priority < t.priority || self.find(solid.instance).is_some() => {
                    Crossing::False
                }
                _ => Crossing::True {
                    other: top.map_or(1.0, |t| t.ior),
                },
            }
        } else {
            match self.find(solid.instance) {
                // Out of a solid the path is not in by the list (it started inside, or the mesh
                // is open): as the plain rule, into what the path is in.
                None => Crossing::True {
                    other: top.map_or(1.0, |t| t.ior),
                },
                Some(k) if Some(k) != self.top_at() => Crossing::False,
                Some(k) => {
                    let mut rest = *self;
                    rest.remove_at(k);
                    Crossing::True {
                        other: rest.top().map_or(1.0, |t| t.ior),
                    }
                }
            }
        }
    }

    fn remove_at(&mut self, k: usize) {
        self.entries.copy_within(k + 1..self.len, k);
        self.len -= 1;
    }

    /// The path goes through a surface of `solid`: into it (noted) or out of it (forgotten).
    pub fn pass(&mut self, solid: Entry, entering: bool) {
        if entering {
            if self.len < MAX_NESTED && self.find(solid.instance).is_none() {
                self.entries[self.len] = solid;
                self.len += 1;
            }
        } else if let Some(k) = self.find(solid.instance) {
            self.remove_at(k);
        }
    }
}

/// The relative index at a true interface of a solid of index `own` (for a dispersive one, its
/// index at the path's wavelength) with `other` beyond it: the far side's index over the near
/// side's.
#[inline]
pub(crate) fn relative_index(own: f32, other: f32, entering: bool) -> f32 {
    if entering {
        own / other
    } else {
        other / own
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GLASS: Entry = Entry {
        instance: 0,
        priority: 2,
        ior: 1.5,
    };
    const WATER: Entry = Entry {
        instance: 1,
        priority: 1,
        ior: 1.33,
    };

    #[test]
    fn a_liquid_in_its_glass_meets_the_glass_at_the_ratio_of_their_indices() {
        // A ray from the air into the glass wall, then through the water's surface inside the
        // wall (false: the glass outranks it), out of the glass into the water, and out of the
        // water into the air.
        let mut list = Interior::default();
        assert_eq!(list.crossing(GLASS, true), Crossing::True { other: 1.0 });
        list.pass(GLASS, true);
        assert_eq!(list.crossing(WATER, true), Crossing::False);
        list.pass(WATER, true);
        assert_eq!(list.top(), Some(GLASS));
        let Crossing::True { other } = list.crossing(GLASS, false) else {
            panic!("the glass's inner face is an interface");
        };
        assert_eq!(other, 1.33);
        assert_eq!(relative_index(1.5, other, false), 1.33 / 1.5);
        list.pass(GLASS, false);
        assert_eq!(list.top(), Some(WATER));
        assert_eq!(list.crossing(WATER, false), Crossing::True { other: 1.0 });
        list.pass(WATER, false);
        assert!(list.entries().is_empty());
        // And back from the water into the glass: water to glass, 1.5 / 1.33.
        list.pass(WATER, true);
        assert_eq!(list.crossing(GLASS, true), Crossing::True { other: 1.33 });
        assert_eq!(relative_index(1.5, 1.33, true), 1.5 / 1.33);
    }

    #[test]
    fn solids_that_do_not_overlap_get_the_plain_indices() {
        let mut list = Interior::default();
        let Crossing::True { other } = list.crossing(WATER, true) else {
            panic!()
        };
        assert_eq!(
            relative_index(1.33, other, true).to_bits(),
            1.33f32.to_bits()
        );
        list.pass(WATER, true);
        let Crossing::True { other } = list.crossing(WATER, false) else {
            panic!()
        };
        assert_eq!(
            relative_index(1.33, other, false).to_bits(),
            (1.0f32 / 1.33).to_bits()
        );
    }

    #[test]
    fn of_equal_priorities_the_last_entered_is_the_inside() {
        let a = Entry {
            instance: 5,
            priority: 0,
            ior: 1.4,
        };
        let b = Entry {
            instance: 6,
            priority: 0,
            ior: 1.6,
        };
        let mut list = Interior::default();
        list.pass(a, true);
        assert_eq!(list.crossing(b, true), Crossing::True { other: 1.4 });
        list.pass(b, true);
        // Leaving a while in b: false.
        assert_eq!(list.crossing(a, false), Crossing::False);
        // Leaving b: into a.
        assert_eq!(list.crossing(b, false), Crossing::True { other: 1.4 });
        // An exit from a solid the path is not in follows the plain rule.
        let c = Entry {
            instance: 9,
            priority: 3,
            ior: 1.7,
        };
        assert_eq!(list.crossing(c, false), Crossing::True { other: 1.6 });
        // The list is bounded.
        let mut full = Interior::default();
        for k in 0..20 {
            full.pass(
                Entry {
                    instance: k,
                    priority: k,
                    ior: 1.5,
                },
                true,
            );
        }
        assert_eq!(full.entries().len(), MAX_NESTED);
    }
}

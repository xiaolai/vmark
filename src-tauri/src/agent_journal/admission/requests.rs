//! The writer's in-memory request state: which request ids an attempt is
//! running, which are fenced (refused or abandoned, never to be admitted),
//! which page generations are sealed, and which page owns each prepared
//! transaction. All of it lives under the writer lock.
//!
//! Key decisions:
//!   - An attempt takes an in-flight entry before it leaves the lock to
//!     resolve its document, and an attempt that comes back without
//!     admitting fences its id, so a duplicate can never be admitted while
//!     the first attempt might still be. A `RequestGuard` that is dropped
//!     unsettled (a panic between the two critical sections) fences too.
//!   - Fences and in-flight entries are bounded per page generation: at
//!     `PER_GENERATION` the generation is sealed, every new id from it is
//!     `staleGeneration`, and nothing more is fenced into it. The page
//!     recovers by registering a replacement. In-flight entries are bounded
//!     in total (`INFLIGHT`); past that a new id is refused and fenced.
//!   - State of a generation no page holds any more is purged before an
//!     insert: a generation is never reissued, so its requests can only be
//!     answered `staleGeneration` and need nothing stored.
//!   - Owners are not purged here: a dead owner's transaction is ended by
//!     the sweep, which removes the entry.
//!
//! @module agent_journal/admission/requests

use std::collections::{HashMap, HashSet};
use std::sync::PoisonError;

use crate::agent_journal::admission::answer::RequestState;
use crate::agent_journal::admission::receipt::{PayloadDigest, RequestId};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::writer::Writer;

/// In-flight entries the writer holds at once.
pub const INFLIGHT: usize = 64;
/// Fences plus in-flight entries a page generation may hold before it is
/// sealed.
pub const PER_GENERATION: usize = 1024;

/// The page a request or transaction belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    pub label: String,
    pub generation: u64,
}

#[derive(Debug)]
struct Inflight {
    invocation: u64,
    digest: PayloadDigest,
    owner: Owner,
}

#[derive(Debug)]
pub(crate) struct Requests {
    inflight: HashMap<RequestId, Inflight>,
    fences: HashMap<RequestId, u64>,
    sealed: HashSet<u64>,
    /// The page that prepared each open transaction.
    pub(crate) owners: HashMap<TxnId, Owner>,
    next_invocation: u64,
    /// Owned transactions the sweep met in a state that is a writer bug
    /// (`owned_end::end_owned_in`).
    pub(crate) owner_invariant_breaks: u64,
    inflight_limit: usize,
    generation_limit: usize,
}

impl Default for Requests {
    fn default() -> Self {
        Self {
            inflight: HashMap::new(),
            fences: HashMap::new(),
            sealed: HashSet::new(),
            owners: HashMap::new(),
            next_invocation: 1,
            owner_invariant_breaks: 0,
            inflight_limit: INFLIGHT,
            generation_limit: PER_GENERATION,
        }
    }
}

impl Requests {
    /// Steps after the receipt lookup for a new attempt of `id`: in
    /// flight, sealed, fenced, then the bounds. `Ok` is the attempt's
    /// invocation, its in-flight entry taken.
    pub(crate) fn begin(
        &mut self,
        id: RequestId,
        digest: &PayloadDigest,
        owner: Owner,
        live: impl FnOnce() -> HashSet<u64>,
    ) -> Result<u64, RequestState> {
        if let Some(held) = self.inflight.get(&id) {
            return Err(if held.digest == *digest {
                RequestState::InFlight
            } else {
                RequestState::Conflict
            });
        }
        if self.sealed.contains(&owner.generation) {
            return Err(RequestState::StaleGeneration);
        }
        if self.fences.contains_key(&id) {
            return Err(RequestState::Abandoned);
        }
        self.purge(&live());
        if self.inflight.len() >= self.inflight_limit {
            log::warn!(
                "agent journal: {} requests in flight; refusing a new one",
                self.inflight.len()
            );
            self.fence(id, owner.generation);
            return Err(RequestState::NotAdmitted(TxnError::Saturated(
                "too many requests in flight".into(),
            )));
        }
        let invocation = self.next_invocation;
        self.next_invocation += 1;
        let generation = owner.generation;
        let digest = digest.clone();
        self.inflight.insert(
            id,
            Inflight {
                invocation,
                digest,
                owner,
            },
        );
        self.seal_if_full(generation);
        Ok(invocation)
    }

    /// Whether `invocation` still holds `id`'s in-flight entry (an abandon
    /// or a purge may have taken it).
    pub(crate) fn holds(&self, id: RequestId, invocation: u64) -> bool {
        self.inflight
            .get(&id)
            .is_some_and(|i| i.invocation == invocation)
    }

    /// Drop `invocation`'s in-flight entry for `id`, if it still holds it.
    pub(crate) fn end(&mut self, id: RequestId, invocation: u64) {
        if self.holds(id, invocation) {
            self.inflight.remove(&id);
        }
    }

    /// `id`'s in-flight entry's digest, if an attempt holds one.
    pub(crate) fn inflight_digest(&self, id: RequestId) -> Option<&PayloadDigest> {
        self.inflight.get(&id).map(|i| &i.digest)
    }

    /// Take `id`'s in-flight entry away from its attempt and fence it: the
    /// attempt finds its entry gone and answers `abandoned`.
    pub(crate) fn abandon_inflight(&mut self, id: RequestId) {
        if let Some(i) = self.inflight.remove(&id) {
            self.fence(id, i.owner.generation);
        }
    }

    pub(crate) fn is_fenced(&self, id: RequestId) -> bool {
        self.fences.contains_key(&id)
    }

    pub(crate) fn is_sealed(&self, generation: u64) -> bool {
        self.sealed.contains(&generation)
    }

    /// Fence `id` under `generation`, unless the generation is sealed
    /// (nothing more is stored for it; its ids are refused anyway).
    pub(crate) fn fence(&mut self, id: RequestId, generation: u64) {
        if self.sealed.contains(&generation) {
            return;
        }
        self.fences.insert(id, generation);
        self.seal_if_full(generation);
    }

    /// Fence a new id, after purging dead generations' state.
    pub(crate) fn fence_new(&mut self, id: RequestId, generation: u64, live: &HashSet<u64>) {
        self.purge(live);
        self.fence(id, generation);
    }

    /// Drop the request state of every generation not in `live`.
    pub(crate) fn purge(&mut self, live: &HashSet<u64>) {
        self.inflight
            .retain(|_, i| live.contains(&i.owner.generation));
        self.fences.retain(|_, g| live.contains(g));
        self.sealed.retain(|g| live.contains(g));
    }

    fn seal_if_full(&mut self, generation: u64) {
        let fenced = self.fences.values().filter(|g| **g == generation).count();
        let running = self
            .inflight
            .values()
            .filter(|i| i.owner.generation == generation)
            .count();
        if fenced + running >= self.generation_limit && self.sealed.insert(generation) {
            log::warn!(
                "agent journal: page generation {generation} sealed at {} requests",
                fenced + running
            );
        }
    }

    #[cfg(test)]
    pub(crate) fn inflight_len(&self) -> usize {
        self.inflight.len()
    }

    #[cfg(test)]
    pub(crate) fn fences_len(&self) -> usize {
        self.fences.len()
    }

    #[cfg(test)]
    pub(crate) fn set_limits(&mut self, inflight: usize, per_generation: usize) {
        self.inflight_limit = inflight;
        self.generation_limit = per_generation;
    }
}

/// An attempt's hold on its in-flight entry between the critical section
/// that took it and the one that settles it.
pub(crate) struct RequestGuard<'w> {
    pub(crate) writer: &'w Writer,
    pub(crate) id: RequestId,
    pub(crate) invocation: u64,
    pub(crate) generation: u64,
    pub(crate) settled: bool,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        let mut g = self
            .writer
            .inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if g.requests.holds(self.id, self.invocation) {
            g.requests.end(self.id, self.invocation);
            g.requests.fence(self.id, self.generation);
        }
        log::error!("agent journal: request {} left unsettled; fenced", self.id);
    }
}

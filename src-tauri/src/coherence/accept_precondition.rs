//! Reproject-under-lock accept precondition (Phase 3.0, WI-3.0e; design v4.3 —
//! the review-verified accept BLOCKER 3, G-B rounds 3–6). Before an operator
//! accept appends, it re-projects the affected edges under the kernel lock and
//! compares to what the preview saw. Two subtleties the reviews forced:
//!
//! 1. **Check-independent** — the comparison uses a *structural class* that
//!    erases ONLY the semantic verdict (the four version-stale-with-a-verdict
//!    `EdgeState`s collapse to one `Stale`; `Fresh{ratified, ahead}` is kept).
//!    So a semantic check landing between preview and accept can NEVER cause a
//!    rejection — accept is never blocked by a verdict (I3/§14).
//! 2. **Keyed by *physical* edge identity**, not `SemanticEdgeKey` — the latter
//!    is a bag key (coincident edges share it), so a map keyed by it would drop
//!    collisions. The physical key `(txf, input, downstream, downstream_rev)` is
//!    the edges-table PK and is unique.

use std::collections::HashMap;

use uuid::Uuid;

use super::project::EdgeState;
use super::types::{ObjectId, RevisionId};

/// The check-independent structural class of a projected edge state (v4.3).
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum StructuralClass {
    /// Edge retired (`project_edge` returned `None`).
    Retired,
    /// Kept split — a ratification or an "ahead" head move IS structural.
    Fresh {
        ratified: bool,
        ahead: bool,
    },
    /// The four `VersionStale | StaleValid | StaleContradicted | StaleUnknown`
    /// states collapse here — they differ ONLY by the check verdict.
    Stale,
    Waived,
    Diverged {
        multi_head: bool,
    },
    Unpinnable,
}

/// Map a projected state to its structural class, erasing only the verdict.
pub fn structural_class(state: Option<&EdgeState>) -> StructuralClass {
    match state {
        None => StructuralClass::Retired,
        Some(EdgeState::Fresh { ratified, ahead }) => StructuralClass::Fresh {
            ratified: *ratified,
            ahead: *ahead,
        },
        Some(EdgeState::VersionStale)
        | Some(EdgeState::StaleValid)
        | Some(EdgeState::StaleContradicted)
        | Some(EdgeState::StaleUnknown) => StructuralClass::Stale,
        Some(EdgeState::Waived) => StructuralClass::Waived,
        Some(EdgeState::Diverged { multi_head }) => StructuralClass::Diverged {
            multi_head: *multi_head,
        },
        Some(EdgeState::Unpinnable) => StructuralClass::Unpinnable,
    }
}

/// Unique physical edge identity — the edges-table PK (`index.rs:42`). This is
/// the precondition map key; `SemanticEdgeKey` must NOT be used (it is a bag).
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct PhysicalEdgeId {
    pub txf: Uuid,
    pub input: u32,
    pub downstream: ObjectId,
    pub downstream_rev: RevisionId,
}

/// The projected structural state of the affected set, keyed for comparison.
pub type ClassMap = HashMap<PhysicalEdgeId, StructuralClass>;

/// Does the accept precondition hold? True iff the re-projected class map equals
/// the one the preview captured, **per physical edge**. Any structural change —
/// a base-head move, a retirement, a ratification, a waiver, a context repin, a
/// compensating swap between two edges — fails it; a pure semantic-check arrival
/// does not (it never changes a class).
pub fn precondition_holds(preview: &ClassMap, reprojected: &ClassMap) -> bool {
    preview == reprojected
}

#[cfg(test)]
#[path = "accept_precondition.test.rs"]
mod tests;

//! `Extract-Canon` — the first multi-object operator (Phase 4, WI-4.3; SP-canon).
//! It proposes a **changeset**: a new **canon carrier** object holding the
//! canonical content for a concept, plus one **conformer** candidate per
//! conforming object that records a `Conformance` edge to the carrier. The whole
//! changeset commits atomically via the group-commit (`accept_group`).
//!
//! Grounded in SP-canon: canon stays claim-based / Context-hinged, but the
//! carrier object is the *version anchor* — advancing the carrier (editing its
//! canonical content) restales every conformer through the existing projection
//! (conformance is a version-propagating `OriginEdgeKind`).
//!
//! STATUS: **redesigned; pending G-B re-review.** It commits through the
//! group-commit (`accept_group`), whose G-B MAJOR GAPS are now closed
//! (`design-accept-consistency.md`): durable group identity, whole-group
//! preflight, defined partial-recovery, and — for this operator specifically —
//! the group preview now surfaces the new conformance edges (#5,
//! `preview::project_group`). Ships once the G-B re-review passes.

use super::edge_kind::OriginEdgeKind;
use super::operator::Candidate;
use super::types::{InputRef, InputRole, ObjectId, RevisionId};

/// A conforming object to fold under the canon: its id, current content, and
/// current single head (the base the conformance revision is recorded over).
pub struct Conformer {
    pub object: ObjectId,
    pub content: String,
    pub base: RevisionId,
}

/// Propose an `Extract-Canon` changeset for `concept`: the carrier candidate
/// (a brand-new object) followed by one candidate per conformer, each declaring
/// a **conformance** input to the carrier. In-memory only; nothing commits until
/// the group accept. Distinct objects (carrier + each conformer), so the group
/// protocol's distinct-object invariant holds — provided no conformer *is* the
/// carrier object (a caller error the group accept also rejects).
pub fn extract_canon(
    carrier_object: ObjectId,
    carrier_content: String,
    concept: &str,
    conformers: &[Conformer],
) -> Vec<Candidate> {
    let carrier = Candidate::new_root(
        carrier_object,
        carrier_content,
        Vec::new(),
        "extract-canon",
        &format!("canon for {concept}"),
    );
    let mut changeset = Vec::with_capacity(conformers.len() + 1);
    let carrier_rev = carrier.revision.clone();
    changeset.push(carrier);

    for c in conformers {
        // The conformer gains a conformance edge to the carrier: a revision over
        // its current head, same content, declaring the carrier as a conformance
        // input (edge inference — the relationship is recorded, not authored).
        let conformance = InputRef {
            object: carrier_object,
            revision: carrier_rev.clone(),
            role: InputRole::Direct,
            kind: OriginEdgeKind::Conformance,
        };
        changeset.push(Candidate::new(
            c.object,
            c.content.clone(),
            c.base.clone(),
            vec![conformance],
            "extract-canon",
            &format!("conform to {concept}"),
        ));
    }
    changeset
}

#[cfg(test)]
#[path = "extract_canon.test.rs"]
mod tests;

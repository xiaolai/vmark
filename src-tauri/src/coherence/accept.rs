//! Operator commit-on-accept (Phase 3, WI-3.4; design v4.1/v4.2/v4.3/v4.6). The
//! human-only accept that turns a previewed candidate into one committed
//! transformation. It is an idempotency + optimistic-concurrency protocol, not a
//! capture wrapper — it composes the review-verified Phase-3.0 primitives:
//!
//! 1. **tamper check** (v4.6): recompute the content hash + revision id from the
//!    resubmitted payload; reject a mismatch.
//! 2. **ledger-authoritative idem lookup** (v4.2): if this idem already
//!    committed, return the ORIGINAL receipt without appending — closes the
//!    lost-response-retry hole across the append-before-apply torn window.
//! 3. **base-head revalidation** (D6): the candidate's base must still be the
//!    single live head.
//! 4. **reproject-under-lock precondition** (v4.3): the affected set's structural
//!    classes must equal what the preview saw (check-independent, so a concurrent
//!    semantic verdict never blocks accept).
//! 5. **append** one transformation with the deterministic idem (v4.1).

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::accept_precondition::{precondition_holds, ClassMap};
use super::dag::Resolved;
use super::operator::Candidate;
use super::operator_accept::operator_accept_idem;
use super::state::WorkspaceKernel;
use super::types::{Agent, AgentType, ContentHash, Envelope, RevisionId, FORMAT_VERSION};

/// The result of an accept. `committed` is false when a retry returned the
/// original entry instead of appending a duplicate (idempotent).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptReceipt {
    pub entry_id: Uuid,
    pub revision: String,
    pub committed: bool,
}

/// Accept a previewed candidate. `preview_classes` is the structural-class map
/// the preview produced (v4.3/v4.6 — the client resubmits it). Human-only (D6).
pub fn accept_candidate(
    kernel: &mut WorkspaceKernel,
    candidate: &Candidate,
    preview_classes: &ClassMap,
    now: &str,
) -> Result<AcceptReceipt, String> {
    // 1. Tamper check — recompute the content-addressed identity.
    let digest: [u8; 32] = Sha256::digest(candidate.content.as_bytes()).into();
    if ContentHash::from_digest(&digest) != candidate.content_hash {
        return Err("candidate content hash mismatch (tamper)".into());
    }
    if RevisionId::compute(&candidate.content_hash, &candidate.parents) != candidate.revision {
        return Err("candidate revision id mismatch (tamper)".into());
    }

    // The committed transformation + its deterministic idem (human agent, D6).
    let txf = candidate.to_transformation(Agent {
        kind: AgentType::Human,
        id: None,
    });
    let idem = operator_accept_idem(&candidate.operator, FORMAT_VERSION, &txf)?;

    // 2. Ledger-authoritative idem lookup (v4.2): the ledger is the source of
    // truth, readable regardless of index state, so a retry after a torn crash
    // still finds the original and never double-appends.
    let read = kernel.ledger().read_all()?;
    if let Some(existing) = read.entries.iter().find(|e| e.idem == idem) {
        return Ok(AcceptReceipt {
            entry_id: existing.id,
            revision: candidate.revision.as_str().to_string(),
            committed: false,
        });
    }

    // 3. Base-head revalidation (D6): the base must still be the single live head.
    let base = candidate
        .parents
        .first()
        .ok_or("candidate has no base parent")?;
    match kernel.index().resolve_live(&candidate.object)? {
        Resolved::Single(head) if &head == base => {}
        _ => return Err("stale base — re-preview required".into()),
    }

    // 4. Reproject-under-lock precondition (v4.3): the affected set must be
    // structurally unchanged since the preview.
    let now_preview = kernel.index().project_candidates(candidate, now)?;
    if !precondition_holds(preview_classes, &now_preview.structural_classes) {
        return Err("affected set changed since preview — re-preview required".into());
    }

    // 5. Append. Store the candidate content in the CAS (its content_hash must
    // resolve later), then append one transformation with the deterministic idem.
    kernel.ensure_initialized()?;
    let stored = kernel.snapshots().put_text(&candidate.content)?;
    if stored != candidate.content_hash {
        return Err("CAS stored a different hash than the candidate declares".into());
    }
    let mut env = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(&txf).map_err(|e| e.to_string())?,
    );
    env.idem = idem; // deterministic (v4.1), overriding the random mint
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;

    Ok(AcceptReceipt {
        entry_id,
        revision: candidate.revision.as_str().to_string(),
        committed: true,
    })
}

#[cfg(test)]
#[path = "accept.test.rs"]
mod tests;

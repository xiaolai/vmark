//! Multi-object group-commit accept (the increment the design record deferred).
//! A **changeset** of candidates over **distinct objects** (e.g. `Extract-Canon`'s
//! carrier + N conformers) committed as a group. Over an append-only ledger,
//! "atomic" is *idempotent + replayable*: a crash mid-group leaves the committed
//! members, and a retry completes the rest (each member is idempotent by its own
//! v4.1 idem). Correctness argument (mirrors the single accept, per-member):
//!
//! - **Idempotent retry** — if every member's idem is already in the ledger, the
//!   group returns the original receipts without appending.
//! - **Partial-crash recovery** — if *some* members are present, the group was
//!   already validated at its first accept; recovery just commits the missing
//!   members (no re-preview — completing a validated group).
//! - **Fresh commit** — if *no* member is present, the group reprojects the
//!   **base** (must be unchanged since the group preview, v4.3) then commits all.
//!   Members are over distinct objects, so their per-member base-head checks are
//!   independent and they never reject each other.
//!
//! NOTE: like the single accept before it, this protocol should get a cross-model
//! (G-B) review before it ships in a release — it is committed here behind tests.

use sha2::{Digest, Sha256};

use super::accept::AcceptReceipt;
use super::accept_precondition::{precondition_holds, ClassMap};
use super::dag::Resolved;
use super::operator::Candidate;
use super::operator_accept::operator_accept_idem;
use super::preview::GroupPreview;
use super::state::WorkspaceKernel;
use super::types::{Agent, AgentType, ContentHash, Envelope, RevisionId, FORMAT_VERSION};

fn member_idem(candidate: &Candidate) -> Result<uuid::Uuid, String> {
    let txf = candidate.to_transformation(Agent {
        kind: AgentType::Human,
        id: None,
    });
    operator_accept_idem(&candidate.operator, FORMAT_VERSION, &txf)
}

/// Tamper check: recompute the content-addressed identity from the payload.
fn verify_untampered(candidate: &Candidate) -> Result<(), String> {
    let digest: [u8; 32] = Sha256::digest(candidate.content.as_bytes()).into();
    if ContentHash::from_digest(&digest) != candidate.content_hash {
        return Err("candidate content hash mismatch (tamper)".into());
    }
    if RevisionId::compute(&candidate.content_hash, &candidate.parents) != candidate.revision {
        return Err("candidate revision id mismatch (tamper)".into());
    }
    Ok(())
}

/// Commit one member (its object is distinct within the group, so its base-head
/// check is independent). Returns the receipt; `committed=false` if it was
/// already present (idempotent).
fn commit_member(
    kernel: &mut WorkspaceKernel,
    candidate: &Candidate,
    idem: uuid::Uuid,
    existing: Option<uuid::Uuid>,
) -> Result<AcceptReceipt, String> {
    if let Some(entry_id) = existing {
        return Ok(AcceptReceipt {
            entry_id,
            revision: candidate.revision.as_str().to_string(),
            committed: false,
        });
    }
    // Base-head revalidation for THIS object.
    let base = candidate
        .parents
        .first()
        .ok_or("candidate has no base parent")?;
    match kernel.index().resolve_live(&candidate.object)? {
        Resolved::Single(head) if &head == base => {}
        Resolved::Absent => {} // a brand-new object (e.g. a canon carrier) has no head
        _ => return Err("stale base — re-preview required".into()),
    }
    kernel.ensure_initialized()?;
    let stored = kernel.snapshots().put_text(&candidate.content)?;
    if stored != candidate.content_hash {
        return Err("CAS stored a different hash than the candidate declares".into());
    }
    let txf = candidate.to_transformation(Agent {
        kind: AgentType::Human,
        id: None,
    });
    let mut env = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(&txf).map_err(|e| e.to_string())?,
    );
    env.idem = idem;
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;
    Ok(AcceptReceipt {
        entry_id,
        revision: candidate.revision.as_str().to_string(),
        committed: true,
    })
}

/// Accept a group of candidates over distinct objects. `preview` is the group
/// preview the client holds (v4.3/v4.6); its `base_classes` gate the fresh path.
pub fn accept_group(
    kernel: &mut WorkspaceKernel,
    candidates: &[Candidate],
    preview: &GroupPreview,
    now: &str,
) -> Result<Vec<AcceptReceipt>, String> {
    if candidates.is_empty() {
        return Err("empty changeset".into());
    }
    // Distinct objects — a changeset touches each object at most once.
    let mut objects = std::collections::HashSet::new();
    for c in candidates {
        verify_untampered(c)?;
        if !objects.insert(c.object) {
            return Err("group has two candidates for the same object".into());
        }
    }

    // Per-member idems + which are already committed (ledger-authoritative).
    let read = kernel.ledger().read_all()?;
    let mut idems = Vec::with_capacity(candidates.len());
    let mut existing = Vec::with_capacity(candidates.len());
    for c in candidates {
        let idem = member_idem(c)?;
        let hit = read.entries.iter().find(|e| e.idem == idem).map(|e| e.id);
        idems.push(idem);
        existing.push(hit);
    }
    let present = existing.iter().filter(|e| e.is_some()).count();

    // FRESH group (none present): reproject the base and require it unchanged
    // since the preview. (Partial/complete groups skip this — already validated.)
    if present == 0 {
        let live: ClassMap = kernel.index().project_group(candidates, now)?.base_classes;
        if !precondition_holds(&preview.base_classes, &live) {
            return Err("base changed since group preview — re-preview required".into());
        }
    }

    // Commit each member (idempotent; present ones return their original receipt).
    let mut receipts = Vec::with_capacity(candidates.len());
    for (i, c) in candidates.iter().enumerate() {
        receipts.push(commit_member(kernel, c, idems[i], existing[i])?);
    }
    Ok(receipts)
}

#[cfg(test)]
#[path = "accept_group.test.rs"]
mod tests;

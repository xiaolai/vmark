//! Multi-object group-commit accept (the increment the design record deferred).
//! A **changeset** of candidates over **distinct objects** (e.g. `Extract-Canon`'s
//! carrier + N conformers) committed as a group. Over an append-only ledger,
//! "atomic" is *idempotent + replayable*: a crash mid-group leaves the committed
//! members, and a retry completes the rest (each member is idempotent by its own
//! v4.1 idem). Correctness argument (mirrors the single accept, per-member):
//!
//! - **Whole-group preflight** — every not-present member's base-head is
//!   validated BEFORE any append (`preflight_member`), so a stale member fails
//!   the whole group with no partial commit.
//! - **Fresh commit** — if *no* member is present, the group reprojects the
//!   **base** (must be unchanged since the group preview, v4.3) then commits all.
//!   Members are over distinct objects, so their base-head checks are independent.
//! - **Partial-crash recovery** — if *some* members are present (found by the
//!   **group-folded idem**, so they provably belong to THIS group), the group was
//!   validated at its first accept; recovery commits exactly the missing members
//!   and skips the now-stale base reproject.
//! - **Idempotent full retry** — if every member is present, the group returns
//!   the original receipts without appending.
//!
//! STATUS: **NOT SHIP-READY — G-B re-review returned DO-NOT-SHIP (8 MAJOR,
//! thread `019f7c7e…`).** Full disposition: `design-accept-consistency.md`.
//! Correctness properties now HELD (fix-now set landed + tested):
//!   - **Group identity binds the WHOLE group** — `group_id` hashes the members'
//!     sorted *ungrouped* accept idems (full member identity, not just revisions,
//!     re-review #4) and folds into each member's grouped idem, so the O(1)
//!     presence lookup answers "committed AS PART OF THIS EXACT GROUP".
//!   - **Whole-group preflight** (`preflight_member`) — a stale member fails the
//!     group with no partial commit.
//!   - **Fresh reproject checks base AND new-edge classes** (#8) — a new edge
//!     going stale between preview and accept is caught.
//!   - Accepts refuse on a poisoned kernel (#3, `ensure_available`).
//!
//! Still DEFERRED before ship (own design pass + a third review):
//!   - **#5 durable prepare/manifest** — recovery still depends on the client
//!     resubmitting the exact group; the ledger alone can't reconstruct it.
//!   - **#6 recovery revalidation** — a partial completed after an intervening
//!     write can commit against changed structural context (present>0 skips the
//!     reproject); needs a persisted validated-base snapshot.
//!   - **#7 cross-process serialization** — distinct-candidate races across
//!     processes can strand an unrecoverable partial; needs a workspace lock.

use sha2::{Digest, Sha256};

use super::accept::AcceptReceipt;
use super::accept_precondition::precondition_holds;
use super::dag::Resolved;
use super::operator::Candidate;
use super::operator_accept::operator_accept_idem;
use super::preview::GroupPreview;
use super::state::WorkspaceKernel;
use super::types::{Agent, AgentType, ContentHash, Envelope, RevisionId, FORMAT_VERSION};

/// Content-addressed group identity (design-accept-consistency #1, hardened for
/// re-review #4): the hash of the members' **sorted ungrouped accept idems**.
/// Each member's ungrouped idem is its full canonical accept preimage WITHOUT the
/// group fold (`operator_accept_idem(.., None)`) — so it binds object, inputs,
/// edge kind, operator, agent, and intent, not merely content+parents, and it
/// carries no group_id (no circularity when this is then folded back INTO each
/// member's grouped idem). The result: a member committed as part of this group
/// has a grouped idem that encodes the WHOLE group, so the O(1) presence check
/// answers "committed AS PART OF THIS EXACT GROUP" — two groups whose members
/// merely share content+parents can no longer collide, and a standalone commit
/// of the same candidate (different idem) is never misread as membership.
fn group_id(candidates: &[Candidate]) -> Result<String, String> {
    let mut ids: Vec<uuid::Uuid> = Vec::with_capacity(candidates.len());
    for c in candidates {
        let txf = c.to_transformation(Agent {
            kind: AgentType::Human,
            id: None,
        });
        ids.push(operator_accept_idem(
            &c.operator,
            FORMAT_VERSION,
            &txf,
            None,
        )?);
    }
    ids.sort_unstable();
    let mut buf = Vec::new();
    buf.extend_from_slice(b"vmark-group-v2"); // v2: full member identity (#4)
    for id in ids {
        let bytes = id.as_bytes();
        buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        buf.extend_from_slice(bytes);
    }
    let digest: [u8; 32] = Sha256::digest(&buf).into();
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

fn member_idem(candidate: &Candidate, group: &str) -> Result<uuid::Uuid, String> {
    let txf = candidate.to_transformation(Agent {
        kind: AgentType::Human,
        id: None,
    });
    operator_accept_idem(&candidate.operator, FORMAT_VERSION, &txf, Some(group))
}

/// Preflight one not-yet-present member (design-accept-consistency #2): its base
/// must still be the single live head, or — for a brand-new object (a carrier) —
/// the object must be genuinely absent. This runs for EVERY not-present member
/// BEFORE any member is appended, so a stale member can never leave a partial
/// commit. `commit_member` re-checks at append time (defense-in-depth); under
/// the kernel's serialized single-writer path the two always agree.
fn preflight_member(kernel: &WorkspaceKernel, candidate: &Candidate) -> Result<(), String> {
    match (
        candidate.parents.first(),
        kernel.index().resolve_live(&candidate.object)?,
    ) {
        (Some(base), Resolved::Single(head)) if &head == base => Ok(()),
        (None, Resolved::Absent) => Ok(()),
        _ => Err("stale base — re-preview required".into()),
    }
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
    // Base-head revalidation for THIS object. A revision over a base requires
    // the base to still be the single head; a brand-new object (a carrier, no
    // parents) requires the object to be genuinely absent.
    match (
        candidate.parents.first(),
        kernel.index().resolve_live(&candidate.object)?,
    ) {
        (Some(base), Resolved::Single(head)) if &head == base => {}
        (None, Resolved::Absent) => {}
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
    // A poisoned kernel's O(1) presence lookup is untrustworthy (re-review #3).
    kernel.ensure_available()?;
    // Distinct objects + tamper check — a changeset touches each object once.
    let mut objects = std::collections::HashSet::new();
    for c in candidates {
        verify_untampered(c)?;
        if !objects.insert(c.object) {
            return Err("group has two candidates for the same object".into());
        }
    }

    // Per-member GROUP-FOLDED idems + presence via the O(1) index lookup. A hit
    // means the member was committed AS PART OF THIS GROUP (its idem encodes the
    // group id, design-accept-consistency #1) — never a coincidental standalone
    // commit. The index is authoritative here (heal-on-open, Fix A).
    let group = group_id(candidates)?;
    let mut idems = Vec::with_capacity(candidates.len());
    let mut existing = Vec::with_capacity(candidates.len());
    for c in candidates {
        let idem = member_idem(c, &group)?;
        existing.push(kernel.index().entry_id_by_idem(&idem)?);
        idems.push(idem);
    }
    let present = existing.iter().filter(|e| e.is_some()).count();

    // Preflight EVERY not-yet-present member BEFORE any append (#2): a stale
    // member fails the whole group here, never after some members committed.
    // (Present members were validated at the group's first accept.)
    for (i, c) in candidates.iter().enumerate() {
        if existing[i].is_none() {
            preflight_member(kernel, c)?;
        }
    }

    // FRESH group (none present): this group has never committed, so run the
    // reproject (optimistic concurrency vs the preview). It compares BOTH the
    // committed base edges AND the members' new-edge after-classes (#8): a new
    // edge pinned to an external upstream can go stale between preview and accept
    // even when every base head is unchanged. A group with SOME members present
    // is a crash-recovery of an already-validated group (the present members
    // carry this group's id) — completion skips the reproject (the base has since
    // advanced past the preview by the group's own committed members; #1/#3).
    if present == 0 {
        let live = kernel.index().project_group(candidates, now)?;
        if !precondition_holds(&preview.base_classes, &live.base_classes)
            || !precondition_holds(&preview.new_edge_classes, &live.new_edge_classes)
        {
            return Err(
                "base or new-edge state changed since group preview — re-preview required".into(),
            );
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

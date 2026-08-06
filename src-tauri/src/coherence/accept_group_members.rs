//! Per-member helpers for a group commit: identity, idempotence, preflight and
//! the single-member append.
//!
//! Split out of `accept_group.rs` for size. Everything here is scoped to ONE
//! candidate; the orchestration across the group stays in `accept_group.rs`,
//! and the reopen-time replay in `accept_group_recover.rs`.
//!
//! @coordinates-with accept_group.rs — the group orchestration that calls these
//! @module coherence/accept_group_members

use sha2::{Digest, Sha256};

use super::accept::AcceptReceipt;
use super::dag::Resolved;
use super::operator::Candidate;
use super::operator_accept::operator_accept_idem;
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
pub(super) fn group_id(candidates: &[Candidate]) -> Result<String, String> {
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

pub(super) fn member_idem(candidate: &Candidate, group: &str) -> Result<uuid::Uuid, String> {
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
pub(super) fn preflight_member(
    kernel: &WorkspaceKernel,
    candidate: &Candidate,
) -> Result<(), String> {
    // Arity gate (G-B re-review 03 H2): a group member must have AT MOST one
    // parent. Recovery reconstructs each member from its manifest and refuses a
    // multi-parent transformation (`group_prepare::to_candidate`), so admitting
    // one here would let a crash strand a prepared group its own recovery path
    // can never complete. A forward-operator member is 0 parents (a brand-new
    // carrier) or 1 (its base); a merge is never a group member.
    if candidate.parents.len() > 1 {
        return Err("a group member cannot have multiple parents".into());
    }
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
pub(super) fn verify_untampered(candidate: &Candidate) -> Result<(), String> {
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
pub(super) fn commit_member(
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

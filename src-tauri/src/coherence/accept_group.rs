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
//! STATUS: **NOT SHIP-READY — a THIRD review (`019f7cbd…`) returned DO-NOT-SHIP
//! (7 MAJOR).** Three independent reviews, three DO-NOT-SHIP: the group-commit is
//! a genuine distributed-systems design project (a cross-process lock + a causal
//! `attempt_id` + time-aware recovery + a CAS-backed manifest + current-incident-
//! edge revalidation), NOT session-tail patching. The malformed-prepare poison
//! (#7) is fixed; everything else is the dedicated project. See
//! `design-accept-consistency.md` "Third review". The properties below hold, but
//! do NOT constitute ship-readiness:
//!   - **Group identity binds the WHOLE group** (#4) — `group_id` hashes the
//!     members' sorted *ungrouped* accept idems and folds into each grouped idem,
//!     so the O(1) presence lookup answers "committed AS PART OF THIS EXACT GROUP".
//!   - **Whole-group preflight** (#2, `preflight_member`) — a stale member fails
//!     the group with no partial commit.
//!   - **Fresh reproject checks base AND new-edge classes** (#8).
//!   - **Poisoned-kernel accepts refuse** (#3, `ensure_available`).
//!   - **Durable prepare/manifest** (#5, `group_prepare`) — a fresh group appends
//!     a `group-prepare` (member manifest + base-head/resolution snapshot) BEFORE
//!     committing, so the ledger alone can reconstruct + enumerate the group.
//!   - **Recovery revalidation** (#6) — a partial group revalidates the prepared
//!     snapshot against the CURRENT workspace (a committed member's own head move
//!     is expected; any other drift is external) and completes only if unchanged.
//!   - **Defined abort** (#7) — on external drift the attempt appends a durable
//!     `group-abort` and rejects (re-preview → a fresh attempt supersedes it),
//!     so a partial is never a permanently-stuck deadlock. (Full cross-process
//!     serialization under simultaneous instances is a documented follow-up; the
//!     abort makes the outcome defined rather than corrupt.)

use sha2::{Digest, Sha256};

use super::accept::AcceptReceipt;
use super::accept_precondition::precondition_holds;
use super::dag::Resolved;
use super::group_prepare::{self, GroupPrepare, Lifecycle, PreparedMember};
use super::operator::Candidate;
use super::operator_accept::operator_accept_idem;
use super::preview::GroupPreview;
use super::state::WorkspaceKernel;
use super::types::{Agent, AgentType, ContentHash, Envelope, ObjectId, RevisionId, FORMAT_VERSION};

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

    // Fully committed already → idempotent full retry (return the originals).
    if present == candidates.len() {
        return Ok(candidates
            .iter()
            .enumerate()
            .map(|(i, c)| AcceptReceipt {
                entry_id: existing[i].expect("present member has an entry id"),
                revision: c.revision.as_str().to_string(),
                committed: false,
            })
            .collect());
    }

    let committed: Vec<(ObjectId, RevisionId)> = candidates
        .iter()
        .enumerate()
        .filter(|(i, _)| existing[*i].is_some())
        .map(|(_, c)| (c.object, c.revision.clone()))
        .collect();

    match group_prepare::find_latest(kernel, &group)? {
        // RECOVERY: a prepare is the latest record. Revalidate the prepared
        // base-head/resolution snapshot against the CURRENT workspace, accounting
        // for the members already committed (#6). Unchanged → complete the
        // missing members. Changed → the attempt is dead: append a durable abort
        // and require a re-preview — #7 is now a DEFINED outcome (abort → fresh
        // re-run), never a permanently stuck partial.
        Lifecycle::Prepared(prepare) => {
            if !group_prepare::revalidate(kernel.index(), &prepare, &committed)? {
                group_prepare::append_abort(kernel, &group, &prepare.snapshot)?;
                return Err("group aborted — the workspace changed since it was prepared; re-preview and re-run".into());
            }
            for (i, c) in candidates.iter().enumerate() {
                if existing[i].is_none() {
                    preflight_member(kernel, c)?;
                }
            }
        }
        // FRESH attempt (brand-new group, or the last attempt aborted): preflight
        // the not-present members (#2), reproject the client's preview — base AND
        // new-edge classes (#8) — then append a durable prepare (manifest +
        // base-head/resolution snapshot, #5) BEFORE committing any member.
        Lifecycle::None | Lifecycle::Aborted => {
            for (i, c) in candidates.iter().enumerate() {
                if existing[i].is_none() {
                    preflight_member(kernel, c)?;
                }
            }
            let live = kernel.index().project_group(candidates, now)?;
            if !precondition_holds(&preview.base_classes, &live.base_classes)
                || !precondition_holds(&preview.new_edge_classes, &live.new_edge_classes)
            {
                return Err(
                    "base or new-edge state changed since group preview — re-preview required"
                        .into(),
                );
            }
            let snapshot = group_prepare::compute_snapshot(kernel.index(), candidates)?;
            let prepare = GroupPrepare {
                group_id: group.clone(),
                members: candidates
                    .iter()
                    .map(|c| PreparedMember {
                        object: c.object,
                        revision: c.revision.clone(),
                    })
                    .collect(),
                snapshot,
            };
            group_prepare::append_prepare(kernel, &prepare)?;
        }
    }

    // Commit each not-present member (present ones return their original receipt).
    let mut receipts = Vec::with_capacity(candidates.len());
    for (i, c) in candidates.iter().enumerate() {
        receipts.push(commit_member(kernel, c, idems[i], existing[i])?);
    }
    Ok(receipts)
}

#[cfg(test)]
#[path = "accept_group.test.rs"]
mod tests;

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
//! STATUS: **six DO-NOT-SHIP reviews; R1 (full pessimistic lock) implemented,
//! pending a SEVENTH review (`019f7d1d…` was the 6th).** The owner chose R1, so
//! EVERY mutating operation now holds the exclusive workspace lock across its
//! WHOLE read-validate-append span via `state::with_write_lock`: the 6th review's
//! CRITICAL (single accept validating its base-head *below* the lock) is closed —
//! `operator_commands` wraps the single accept, `accept_group`/`recover_group`
//! wrap the group, and a nested per-member `append_and_apply` reuses the held
//! lock. The lock also reconciles the index from the ledger on acquire, so a
//! concurrent commit that moved a head is caught as a stale-base rejection, never
//! a silent fork. The two `flock` regressions are fixed: init detection is now
//! marker-based (`.gitattributes` written last — no half-init `.vmark`, #4) and
//! the lock lives in a stack local set-after-reconcile (no reconcile-error/panic
//! leak, #5). Durability + bounds are hardened: `sync_dir_of` fatally fsyncs the
//! staged blob's dir AND its new ancestors before the prepare (#2); every prepare
//! is bound-checked (`group_prepare::validate_bounds`) before staging and at the
//! `append_prepare` choke point, and `read_all` streams each segment with a
//! per-line cap (#3). SCOPE NOTE (spec should adopt): the lock fences *cooperating
//! VMark writers* on Unix; it does NOT fence a raw `git` checkout mutating the
//! tracked ledger, and Windows has only the in-process mutex — both are documented
//! limitations, with the abort keeping any partial defined rather than corrupt. Do
//! NOT flip the Phase 4 marker until the 7th review is clean. Ship-relevant
//! properties of the prepare/commit/abort machinery:
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
//!   - **Defined abort** (#7) — on external drift (e.g. a raw `git` checkout the
//!     lock cannot fence) the attempt appends a durable `group-abort` and rejects
//!     (re-preview → a fresh attempt supersedes it), so a partial is never a
//!     permanently-stuck deadlock — the abort keeps the outcome defined, not
//!     corrupt, even where the lock's reach ends.

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
/// Holds the exclusive workspace lock across the whole op (re-review #1) — every
/// ledger writer takes it, so nothing can interleave — released on any exit.
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
    // #1 (R1): hold the exclusive workspace lock across the WHOLE lifecycle
    // lookup → preflight → prepare → member appends, atomic against every writer.
    kernel.with_write_lock(|k| accept_group_locked(k, candidates, preview, now))
}

fn accept_group_locked(
    kernel: &mut WorkspaceKernel,
    candidates: &[Candidate],
    preview: &GroupPreview,
    now: &str,
) -> Result<Vec<AcceptReceipt>, String> {
    // Distinct objects + tamper check — a changeset touches each object once.
    let mut objects = std::collections::HashSet::new();
    for c in candidates {
        verify_untampered(c)?;
        if !objects.insert(c.object) {
            return Err("group has two candidates for the same object".into());
        }
    }

    // Resolve the group's CURRENT attempt by the causal supersedes chain (#2 —
    // never wall-clock). A fresh attempt snapshots the current context now (it
    // drives both the attempt id and the durable prepare); recovery reuses the
    // tip's stored snapshot.
    let group = group_id(candidates)?;
    let lifecycle = group_prepare::find_latest(kernel, &group)?;
    let fresh_snapshot = match &lifecycle {
        Lifecycle::Prepared(_) => None,
        _ => Some(group_prepare::compute_snapshot(kernel.index(), candidates)?),
    };
    let (attempt_id, recovery_prepare, supersedes) = match lifecycle {
        Lifecycle::Prepared(p) => (p.attempt_id.clone(), Some(*p), None),
        Lifecycle::None => (
            group_prepare::attempt_id_for(&group, fresh_snapshot.as_ref().unwrap(), None),
            None,
            None,
        ),
        Lifecycle::Aborted(p) => (
            group_prepare::attempt_id_for(
                &group,
                fresh_snapshot.as_ref().unwrap(),
                Some(&p.attempt_id),
            ),
            None,
            Some(p.attempt_id),
        ),
    };

    // Per-member ATTEMPT-FOLDED idems + presence via the O(1) index lookup.
    // Folding the ATTEMPT id (not the bare group id) means a superseded attempt's
    // members are never reused by a later attempt (#5). The index is authoritative
    // here (heal-on-open, Fix A).
    let mut idems = Vec::with_capacity(candidates.len());
    let mut existing = Vec::with_capacity(candidates.len());
    for c in candidates {
        let idem = member_idem(c, &attempt_id)?;
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

    let committed: Vec<(ObjectId, RevisionId, uuid::Uuid)> = candidates
        .iter()
        .enumerate()
        .filter_map(|(i, c)| existing[i].map(|id| (c.object, c.revision.clone(), id)))
        .collect();

    match recovery_prepare {
        // RECOVERY: revalidate the tip's snapshot against the CURRENT workspace,
        // accounting for committed members (#6). Unchanged → complete the missing
        // members. Drift → abort THIS attempt (naming its id, #2/#7) and require a
        // re-preview; a fresh re-run supersedes it.
        Some(prepare) => {
            // 6R-3: BIND the prepare's manifest to the submitted changeset. Without
            // this, a ledger prepare that merely names the same `group_id` — most
            // dangerously one with `members: []`, whose empty snapshot revalidates
            // trivially — lets a client commit an unreviewed set through recovery,
            // skipping the fresh preview-class precondition entirely.
            // 8R-4: bind on FULL member identity — object, revision AND the
            // canonical transformation (inputs, operator, agent, intent, content
            // hash). Comparing only (object, revision) let a crafted prepare carry
            // the right pairs with empty or different transformations, so an
            // upstream input that went stale after preview could be committed
            // through recovery — which skips the fresh preview-class check.
            let mut prepared = prepare.members.clone();
            let mut submitted: Vec<PreparedMember> =
                candidates.iter().map(PreparedMember::of).collect();
            let keyf = |m: &PreparedMember| (m.object.0, m.revision.as_str().to_string());
            prepared.sort_by(|a, b| keyf(a).cmp(&keyf(b)));
            submitted.sort_by(|a, b| keyf(a).cmp(&keyf(b)));
            if prepared != submitted {
                return Err(
                    "group prepare does not match the submitted changeset — re-preview and re-run"
                        .into(),
                );
            }
            if !group_prepare::revalidate(kernel.index(), &prepare, &committed, now)? {
                group_prepare::append_abort(kernel, &group, &attempt_id)?;
                return Err("group aborted — the workspace changed since it was prepared; re-preview and re-run".into());
            }
            for (i, c) in candidates.iter().enumerate() {
                if existing[i].is_none() {
                    preflight_member(kernel, c)?;
                }
            }
        }
        // FRESH attempt (brand-new group, or the tip aborted): preflight the
        // not-present members (#2), reproject the client's preview — base AND
        // new-edge classes (#8) — then append a durable prepare (manifest +
        // base-head/resolution snapshot, #5) for THIS attempt BEFORE committing.
        None => {
            for (i, c) in candidates.iter().enumerate() {
                if existing[i].is_none() {
                    preflight_member(kernel, c)?;
                }
            }
            let live = kernel.index().project_group(candidates, now)?;
            // #3c: a truncated affected set means the precondition covers only the
            // first PREVIEW_MAX_EDGES — refuse to commit on an incomplete picture.
            if preview.truncated || live.truncated {
                return Err("group affected set is too large to commit safely (truncated)".into());
            }
            if !precondition_holds(&preview.base_classes, &live.base_classes)
                || !precondition_holds(&preview.new_edge_classes, &live.new_edge_classes)
            {
                return Err(
                    "base or new-edge state changed since group preview — re-preview required"
                        .into(),
                );
            }
            // Build + BOUND-CHECK the prepare BEFORE any CAS write (#3): an
            // oversized changeset is rejected before staging, so a rejected group
            // never orphans content and a too-large prepare line is never appended
            // (which would OOM the client-less recovery that reads it back).
            let prepare = GroupPrepare {
                group_id: group.clone(),
                attempt_id: attempt_id.clone(),
                supersedes,
                members: candidates.iter().map(PreparedMember::of).collect(),
                snapshot: fresh_snapshot.expect("a fresh attempt has a snapshot"),
            };
            group_prepare::validate_bounds(&prepare)?;
            // Stage every member's content in CAS BEFORE the prepare (#6), so a
            // crash right after the prepare still has the content the ledger-only
            // recovery driver needs to reconstruct + commit the member.
            kernel.ensure_initialized()?;
            for c in candidates {
                let stored = kernel.snapshots().put_text(&c.content)?;
                if stored != c.content_hash {
                    return Err("CAS stored a different hash than a candidate declares".into());
                }
                // Fatally fsync the blob's directory (+ ancestors) so it is durable
                // BEFORE the prepare that references it (#2/#6) — no orphaned content.
                kernel.snapshots().sync_dir_of(&stored)?;
            }
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

/// Client-less recovery (re-review #6): complete an incomplete prepared group
/// from the ledger + CAS ALONE — no client candidate list. Reconstructs each
/// member from the durable manifest (content out of CAS), revalidates the
/// prepared snapshot against the current workspace, and commits the missing
/// members, or aborts if the context drifted. Holds the cross-process lock (#1).
pub fn recover_group(
    kernel: &mut WorkspaceKernel,
    group: &str,
    now: &str,
) -> Result<Vec<AcceptReceipt>, String> {
    kernel.ensure_available()?;
    kernel.with_write_lock(|k| recover_group_locked(k, group, now))
}

fn recover_group_locked(
    kernel: &mut WorkspaceKernel,
    group: &str,
    now: &str,
) -> Result<Vec<AcceptReceipt>, String> {
    let prepare = match group_prepare::find_latest(kernel, group)? {
        Lifecycle::Prepared(p) => *p,
        _ => return Err("no recoverable prepared group for that id".into()),
    };
    // Reconstruct the candidates from the manifest — content read back from CAS
    // (#6), each member fully validated (#2). Then verify the reconstructed set
    // hashes to the record's group_id, so a forged/inconsistent manifest cannot
    // make recovery commit the wrong group.
    let mut candidates: Vec<Candidate> = Vec::with_capacity(prepare.members.len());
    for m in &prepare.members {
        let bytes = kernel.read_snapshot(m.content_hash()?)?;
        let content =
            String::from_utf8(bytes).map_err(|e| format!("member content not utf-8: {e}"))?;
        candidates.push(m.to_candidate(content)?);
    }
    if candidates.is_empty() {
        return Err("prepared group has no members".into());
    }
    let mut objects = std::collections::HashSet::new();
    for c in &candidates {
        if !objects.insert(c.object) {
            return Err("prepared group has two members for the same object".into());
        }
    }
    if group_id(&candidates)? != prepare.group_id {
        return Err("prepared manifest does not hash to its group_id (inconsistent)".into());
    }

    let mut idems = Vec::with_capacity(candidates.len());
    let mut existing = Vec::with_capacity(candidates.len());
    for c in &candidates {
        let idem = member_idem(c, &prepare.attempt_id)?;
        existing.push(kernel.index().entry_id_by_idem(&idem)?);
        idems.push(idem);
    }
    if existing.iter().all(Option::is_some) {
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
    let committed: Vec<(ObjectId, RevisionId, uuid::Uuid)> = candidates
        .iter()
        .enumerate()
        .filter_map(|(i, c)| existing[i].map(|id| (c.object, c.revision.clone(), id)))
        .collect();
    if !group_prepare::revalidate(kernel.index(), &prepare, &committed, now)? {
        group_prepare::append_abort(kernel, group, &prepare.attempt_id)?;
        return Err("group aborted — the workspace changed since it was prepared".into());
    }
    for (i, c) in candidates.iter().enumerate() {
        if existing[i].is_none() {
            preflight_member(kernel, c)?;
        }
    }
    let mut receipts = Vec::with_capacity(candidates.len());
    for (i, c) in candidates.iter().enumerate() {
        receipts.push(commit_member(kernel, c, idems[i], existing[i])?);
    }
    Ok(receipts)
}

#[cfg(test)]
#[path = "accept_group.test.rs"]
mod tests;

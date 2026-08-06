//! Crash recovery for an interrupted group commit.
//!
//! Split out of `accept_group.rs` for size. The seam is the lifecycle stage:
//! this file runs on REOPEN, replaying or aborting a prepare record left behind
//! by a process that died mid-commit, while `accept_group.rs` owns the live
//! accept path.
//!
//! @coordinates-with accept_group.rs — the live path and the shared member helpers
//! @coordinates-with group_prepare.rs — the prepare record being recovered
//! @module coherence/accept_group_recover


use super::accept::AcceptReceipt;
use super::accept_group_members::{
    commit_member, group_id, member_idem, preflight_member,
};
use super::group_prepare::{self, Lifecycle};
use super::operator::Candidate;
use super::state::WorkspaceKernel;
use super::types::{ObjectId, RevisionId};

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

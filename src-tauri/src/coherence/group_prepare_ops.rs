//! Ledger operations for group-commit prepare records: find the latest
//! lifecycle state, append a prepare or an abort, and revalidate a snapshot.
//!
//! Split out of `group_prepare.rs` (554 lines) at a behavioural seam: this file
//! WRITES to and QUERIES the ledger, while `group_prepare.rs` keeps the record
//! types and the pure digest/snapshot computations.
//!
//! @coordinates-with group_prepare.rs — the types and digests these operate on
//! @module coherence/group_prepare_ops

use uuid::Uuid;

use super::group_bounds::validate_bounds;
use super::group_prepare::{
    attempt_id_for, digest_uuid, resolution_digest, GroupPrepare, Lifecycle,
};
use super::index::CoherenceIndex;
use super::state::WorkspaceKernel;
use super::types::{Envelope, ObjectId, RevisionId};

/// The current lifecycle for a group, resolved by the causal `supersedes` chain
/// (re-review #2 — NOT by wall-clock time). The tip is the prepare no other
/// prepare supersedes; it is `Aborted` iff its attempt_id has a `group-abort`.
/// Resilient (re-review #7): a record that fails to deserialize is skipped.
pub fn find_latest(kernel: &WorkspaceKernel, group_id: &str) -> Result<Lifecycle, String> {
    let read = kernel.ledger().read_all()?;
    let mut prepares: std::collections::HashMap<String, GroupPrepare> =
        std::collections::HashMap::new();
    let mut aborted: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in &read.entries {
        if e.body.get("group_id").and_then(|v| v.as_str()) != Some(group_id) {
            continue;
        }
        match e.kind.as_str() {
            "group-prepare" => {
                if let Ok(p) = serde_json::from_value::<GroupPrepare>(e.body.clone()) {
                    // Verify the attempt_id is the honest hash of its inputs —
                    // reject a forged/inconsistent one (re-review #7) — AND enforce
                    // the size bounds on the way IN (7th-review 6R-3): a merged or
                    // legacy prepare that exceeds the caps was never validated by
                    // our writer, so it must not become live and enter recovery.
                    if p.attempt_id
                        == attempt_id_for(&p.group_id, &p.snapshot, p.supersedes.as_deref())
                        && validate_bounds(&p).is_ok()
                    {
                        prepares.insert(p.attempt_id.clone(), p);
                    }
                }
            }
            "group-abort" => {
                if let Some(aid) = e.body.get("attempt_id").and_then(|v| v.as_str()) {
                    aborted.insert(aid.to_string());
                }
            }
            _ => {}
        }
    }
    if prepares.is_empty() {
        return Ok(Lifecycle::None);
    }
    // Treat the lifecycle as a DAG over `supersedes` (re-review #2). The tips are
    // the prepares no other prepare supersedes. Hash order is NOT a semantic
    // winner: on a FORK (two offline branches each superseding the same attempt —
    // e.g. a git merge of two clones that both group-committed) there are multiple
    // maximal tips, and picking one by hash could select the stale branch and
    // deadlock. So fail CLOSED, so the caller surfaces "resolve manually" rather
    // than committing against a stale fork. Zero tips with prepares present is a
    // cycle (corruption) — also fail closed, never a silent `None`.
    let superseded: std::collections::HashSet<&str> = prepares
        .values()
        .filter_map(|p| p.supersedes.as_deref())
        .collect();
    let tips: Vec<&GroupPrepare> = prepares
        .values()
        .filter(|p| !superseded.contains(p.attempt_id.as_str()))
        .collect();
    match tips.as_slice() {
        [] => Err(
            "group lifecycle is cyclic — every prepare is superseded (corrupt); resolve manually"
                .into(),
        ),
        [tip] => {
            let tip = (*tip).clone();
            Ok(if aborted.contains(&tip.attempt_id) {
                Lifecycle::Aborted(Box::new(tip))
            } else {
                Lifecycle::Prepared(Box::new(tip))
            })
        }
        _ => Err(
            "group lifecycle has forked across branches (multiple live attempts) — resolve manually"
                .into(),
        ),
    }
}

pub fn append_prepare(kernel: &mut WorkspaceKernel, prepare: &GroupPrepare) -> Result<(), String> {
    validate_bounds(prepare)?; // choke point: no oversized prepare is ever written
    let idem = digest_uuid("vmark-group-prepare-v2", &prepare.attempt_id);
    let mut env = Envelope::create(
        "group-prepare",
        kernel.writer(),
        serde_json::to_value(prepare).map_err(|e| e.to_string())?,
    );
    env.idem = idem;
    kernel.append_and_apply(&env)
}

/// Append a durable abort naming the exact attempt (re-review #2/#7): the abort
/// dominates its prepare by the `supersedes` chain, independent of timestamps.
pub fn append_abort(
    kernel: &mut WorkspaceKernel,
    group_id: &str,
    attempt_id: &str,
) -> Result<(), String> {
    let idem = digest_uuid("vmark-group-abort-v2", attempt_id);
    let mut env = Envelope::create(
        "group-abort",
        kernel.writer(),
        serde_json::json!({ "group_id": group_id, "attempt_id": attempt_id }),
    );
    env.idem = idem;
    kernel.append_and_apply(&env)
}

/// Revalidate a prepared group against the CURRENT workspace at `now`, accounting
/// for the members already committed (#6): each affected object's current head
/// must be its prepared head set, EXCEPT a committed member's object, whose head
/// must be exactly that member's revision (the one group-caused move); the
/// resolution set on the prepare-time affected edges must be unchanged; and `now`
/// must not have passed the earliest resolution expiry (#4 — a waiver expiring is
/// a time-only transition invisible to heads/ids). Any drift → the group aborts.
pub fn revalidate(
    index: &CoherenceIndex,
    prepare: &GroupPrepare,
    // (object, revision, ledger entry-id) of each already-committed member. The
    // entry-id is the member's transformation id — new edges it creates carry it
    // as their `txf`, which is how recovery tells a member's OWN new edge from an
    // external one (re-review #3a — `(downstream, revision)` alone can collide).
    committed: &[(ObjectId, RevisionId, Uuid)],
    now: &str,
) -> Result<bool, String> {
    // Time-dependent transition (#4): a snapshotted waiver has expired. Compare
    // as instants (RFC3339 with any offset), not lexicographically — an offset
    // like `+02:00` makes string order disagree with chronological order. An
    // unparseable timestamp fails closed (abort).
    if let Some(exp) = &prepare.snapshot.earliest_expiry {
        match (
            chrono::DateTime::parse_from_rfc3339(now),
            chrono::DateTime::parse_from_rfc3339(exp),
        ) {
            (Ok(n), Ok(e)) if n < e => {} // not yet expired
            _ => return Ok(false),        // expired, or an unparseable timestamp
        }
    }
    let objects: Vec<ObjectId> = prepare.snapshot.heads.iter().map(|(o, _)| *o).collect();
    let dag = index.load_sub_dag(&objects)?;
    let committed_txfs: std::collections::HashSet<Uuid> =
        committed.iter().map(|(_, _, id)| *id).collect();
    let committed: std::collections::HashMap<ObjectId, &RevisionId> =
        committed.iter().map(|(o, r, _)| (*o, r)).collect();
    for (obj, prep_heads) in &prepare.snapshot.heads {
        let current: std::collections::BTreeSet<String> = dag
            .heads(obj)
            .iter()
            .map(|r| r.as_str().to_string())
            .collect();
        let expected: std::collections::BTreeSet<String> = match committed.get(obj) {
            Some(rev) => std::iter::once(rev.as_str().to_string()).collect(),
            None => prep_heads.iter().map(|r| r.as_str().to_string()).collect(),
        };
        if current != expected {
            return Ok(false); // external head move
        }
    }
    let affected: Vec<(Uuid, u32)> = prepare
        .snapshot
        .affected_edges
        .iter()
        .map(|(t, i)| {
            Ok((
                Uuid::parse_str(t).map_err(|e: uuid::Error| e.to_string())?,
                *i,
            ))
        })
        .collect::<Result<_, String>>()?;
    let all_res = index.all_resolutions()?;
    if resolution_digest(&all_res, &affected) != prepare.snapshot.resolution_digest {
        return Ok(false); // external resolution on a prepare-time edge
    }

    // #3: NO external edge may have appeared incident to a MEMBER object since
    // prepare. We scan only the members' objects (re-review #3b — scanning the
    // affected neighbours would falsely flag their pre-existing edges, which are
    // not in `affected_edges`). A new edge is allowed ONLY if its `txf` is a
    // committed member's own transformation entry-id (re-review #3a — ownership by
    // entry-id, not `(downstream, revision)` which an external txf can collide),
    // and even then it must carry no resolution (fresh at commit → any is external).
    let prepare_keys: std::collections::HashSet<(Uuid, u32)> = affected.iter().cloned().collect();
    for member in &prepare.members {
        let inc = index.edges_incident_to(&member.object)?;
        if inc.truncated {
            return Ok(false); // a super-hub — cannot safely bound the revalidation
        }
        for e in &inc.edges {
            let key = (e.txf, e.input);
            if prepare_keys.contains(&key) {
                continue; // pre-existing edge — covered by the digest above
            }
            if !committed_txfs.contains(&e.txf) {
                return Ok(false); // an external new incident edge (#3a/#3b)
            }
            if all_res.get(&key).is_some_and(|rs| !rs.is_empty()) {
                return Ok(false); // external resolution on a member's new edge
            }
        }
    }
    Ok(true)
}

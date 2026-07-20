//! Durable group-commit lifecycle (design-accept-consistency #5/#6/#7).
//!
//! A multi-object group-commit appends a durable **`group-prepare`** record
//! (member manifest + a base-head/resolution SNAPSHOT) before committing any
//! member, and a **`group-abort`** record when an attempt's context has drifted.
//! Both are keyed by `group_id` and ordered by `(time, id)` — the latest wins.
//!
//! The snapshot is deliberately **concrete state** — the affected objects' head
//! revisions and the set of resolution ids on the affected edges — NOT projected
//! structural classes. Only an *external* write changes concrete state; a
//! committed group member changes only its OWN object's head. So recovery can
//! tell "the group's own progress" from "someone else changed the workspace"
//! without the representation shift that sinks a class-map comparison (a member's
//! new edge moves from a synthetic preview class to a persisted one once it
//! commits).

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::index::CoherenceIndex;
use super::operator::Candidate;
use super::state::WorkspaceKernel;
use super::types::{Envelope, ObjectId, RevisionId};

/// The base-head + resolution snapshot a group commits against.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GroupSnapshot {
    /// Affected object → its head revision set at prepare time (sorted objects).
    pub heads: Vec<(ObjectId, Vec<RevisionId>)>,
    /// The prepare-time affected COMMITTED edges as `(txf, input)` — recovery
    /// recomputes the resolution digest over EXACTLY these (members' new edges,
    /// which appear only after they commit, are excluded on purpose).
    pub affected_edges: Vec<(String, u32)>,
    /// Digest of the resolution ids on `affected_edges` at prepare time.
    pub resolution_digest: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PreparedMember {
    pub object: ObjectId,
    pub revision: RevisionId,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GroupPrepare {
    pub group_id: String,
    /// The attempt's CAUSAL identity — `hash(group_id ‖ snapshot ‖ supersedes)`.
    /// Members' accept idems fold THIS (not the bare group_id), so a superseded
    /// attempt's members are never reused by a later attempt (re-review #5), and
    /// lifecycle ordering follows the `supersedes` chain, never wall-clock time
    /// (re-review #2 — a clock-skewed abort can't be sorted before its prepare).
    pub attempt_id: String,
    /// The attempt this one replaces (the aborted tip), or `None` for the first.
    pub supersedes: Option<String>,
    pub members: Vec<PreparedMember>,
    pub snapshot: GroupSnapshot,
}

/// The current lifecycle for a `group_id`, resolved by the causal `supersedes`
/// chain (NOT by timestamp).
pub enum Lifecycle {
    /// No prepare record — a brand-new group.
    None,
    /// The current (non-superseded) attempt's prepare, still live/recoverable.
    Prepared(Box<GroupPrepare>),
    /// The current attempt's prepare, but its attempt was aborted — a fresh
    /// attempt must `supersede` it.
    Aborted(Box<GroupPrepare>),
}

/// The causal attempt identity. Folds the group id, the reviewed snapshot, and
/// the superseded attempt — so a fresh attempt after an abort is always distinct,
/// even if the workspace context reverts to an earlier snapshot.
pub fn attempt_id_for(
    group_id: &str,
    snapshot: &GroupSnapshot,
    supersedes: Option<&str>,
) -> String {
    let payload = format!(
        "{group_id}\u{1f}{}\u{1f}{}",
        snapshot_digest(snapshot),
        supersedes.unwrap_or("")
    );
    let d: [u8; 32] = Sha256::digest(payload.as_bytes()).into();
    d.iter().map(|b| format!("{b:02x}")).collect()
}

fn digest_uuid(domain: &str, payload: &str) -> Uuid {
    let mut buf = Vec::with_capacity(domain.len() + payload.len() + 8);
    buf.extend_from_slice(domain.as_bytes());
    buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    buf.extend_from_slice(payload.as_bytes());
    let d: [u8; 32] = Sha256::digest(&buf).into();
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[..16]);
    b[6] = (b[6] & 0x0f) | 0x80; // version 8
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    Uuid::from_bytes(b)
}

fn snapshot_digest(s: &GroupSnapshot) -> String {
    let json = serde_json::to_string(s).unwrap_or_default();
    let d: [u8; 32] = Sha256::digest(json.as_bytes()).into();
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compute the base-head + resolution snapshot for a group's affected objects.
pub fn compute_snapshot(
    index: &CoherenceIndex,
    candidates: &[Candidate],
) -> Result<GroupSnapshot, String> {
    let mut objects: Vec<ObjectId> = candidates.iter().map(|c| c.object).collect();
    let mut affected: Vec<(Uuid, u32)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for c in candidates {
        let inc = index.edges_incident_to(&c.object)?;
        for e in &inc.edges {
            objects.push(e.upstream);
            objects.push(e.downstream);
            if seen.insert((e.txf, e.input)) {
                affected.push((e.txf, e.input));
            }
        }
    }
    for c in candidates {
        for i in &c.inputs {
            objects.push(i.object);
        }
    }
    objects.sort_by_key(|o| o.0);
    objects.dedup();
    let dag = index.load_sub_dag(&objects)?;
    let heads: Vec<(ObjectId, Vec<RevisionId>)> =
        objects.iter().map(|o| (*o, dag.heads(o))).collect();

    affected.sort();
    let all_res = index.all_resolutions()?;
    let resolution_digest = resolution_digest(&all_res, &affected);
    Ok(GroupSnapshot {
        heads,
        affected_edges: affected.iter().map(|(t, i)| (t.to_string(), *i)).collect(),
        resolution_digest,
    })
}

type ResMap = std::collections::HashMap<(Uuid, u32), Vec<super::project::EdgeResolution>>;

fn resolution_digest(all_res: &ResMap, affected: &[(Uuid, u32)]) -> String {
    let mut ids: Vec<String> = Vec::new();
    for key in affected {
        if let Some(rs) = all_res.get(key) {
            for r in rs {
                ids.push(format!("{}:{}:{}", key.0, key.1, r.id));
            }
        }
    }
    ids.sort();
    let d: [u8; 32] = Sha256::digest(ids.join("|").as_bytes()).into();
    d.iter().map(|b| format!("{b:02x}")).collect()
}

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
                    prepares.insert(p.attempt_id.clone(), p);
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
    // The tip: a prepare no other prepare supersedes. If more than one (a
    // cross-process race — #1's territory, fenced by the workspace lock), pick
    // deterministically by attempt_id so every reader agrees.
    let superseded: std::collections::HashSet<&str> = prepares
        .values()
        .filter_map(|p| p.supersedes.as_deref())
        .collect();
    let tip = prepares
        .values()
        .filter(|p| !superseded.contains(p.attempt_id.as_str()))
        .max_by(|a, b| a.attempt_id.cmp(&b.attempt_id))
        .cloned();
    Ok(match tip {
        None => Lifecycle::None, // a superseded cycle (corruption) — treat as none
        Some(tip) if aborted.contains(&tip.attempt_id) => Lifecycle::Aborted(Box::new(tip)),
        Some(tip) => Lifecycle::Prepared(Box::new(tip)),
    })
}

/// Append the durable prepare record — idem folds the attempt_id, so each attempt
/// is a distinct record while an idempotent re-prepare of the same attempt dedupes.
pub fn append_prepare(kernel: &mut WorkspaceKernel, prepare: &GroupPrepare) -> Result<(), String> {
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

/// Revalidate a prepared group against the CURRENT workspace, accounting for the
/// members already committed (#6): each affected object's current head must be
/// its prepared head set, EXCEPT a committed member's object, whose head must be
/// exactly that member's revision (the one group-caused move). The resolution
/// set on the prepare-time affected edges must be unchanged. Any other drift is
/// an external change → the group must abort.
pub fn revalidate(
    index: &CoherenceIndex,
    prepare: &GroupPrepare,
    committed: &[(ObjectId, RevisionId)],
) -> Result<bool, String> {
    let objects: Vec<ObjectId> = prepare.snapshot.heads.iter().map(|(o, _)| *o).collect();
    let dag = index.load_sub_dag(&objects)?;
    let committed: std::collections::HashMap<ObjectId, &RevisionId> =
        committed.iter().map(|(o, r)| (*o, r)).collect();
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
    Ok(resolution_digest(&all_res, &affected) == prepare.snapshot.resolution_digest)
}

#[cfg(test)]
#[path = "group_prepare.test.rs"]
mod tests;

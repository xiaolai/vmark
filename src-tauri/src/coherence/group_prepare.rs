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
use super::types::{Agent, AgentType, Envelope, ObjectId, RevisionId, Transformation};

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
    /// The earliest resolution `expires` across the affected edges (re-review #4).
    /// A waiver expiring is a time-dependent structural transition that changes
    /// nothing in the heads or resolution-id set, so recovery must ABORT once
    /// `now` reaches it — otherwise it would complete against a snapshot whose
    /// Waived edge has silently become Stale.
    #[serde(default)]
    pub earliest_expiry: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PreparedMember {
    pub object: ObjectId,
    pub revision: RevisionId,
    /// The full canonical member transformation (re-review #6). The member's
    /// content is staged in CAS BEFORE the prepare (`accept_group`), so recovery
    /// reads it back from CAS by `transformation.outputs[0].content_hash` — the
    /// content is NOT embedded here (an embedded copy would make the ledger record
    /// unbounded).
    pub transformation: Transformation,
}

impl PreparedMember {
    /// The manifest entry for a candidate (its canonical human-agent txf).
    pub fn of(candidate: &Candidate) -> Self {
        Self {
            object: candidate.object,
            revision: candidate.revision.clone(),
            transformation: candidate.to_transformation(Agent {
                kind: AgentType::Human,
                id: None,
            }),
        }
    }

    /// The CAS content hash whose text reconstitutes this member.
    pub fn content_hash(&self) -> Result<&super::types::ContentHash, String> {
        Ok(&self
            .transformation
            .outputs
            .first()
            .ok_or("prepared member has no output")?
            .content_hash)
    }

    /// Reconstruct + FULLY validate the Candidate from the manifest + its CAS
    /// `content` (re-review #2/#6): exactly one output, at most one parent,
    /// member/output object+revision agree, the content hashes to the declared
    /// output hash, and regenerating the transformation from the candidate
    /// reproduces EXACTLY the embedded one (so no forged agent/confidence/extra
    /// field slips through).
    pub fn to_candidate(&self, content: String) -> Result<Candidate, String> {
        if self.transformation.outputs.len() != 1 {
            return Err("prepared member must have exactly one output".into());
        }
        let out = &self.transformation.outputs[0];
        if out.object != self.object || out.revision != self.revision {
            return Err("prepared member object/revision disagrees with its transformation".into());
        }
        if out.parents.len() > 1 {
            return Err("prepared member has more than one parent".into());
        }
        let operator = self
            .transformation
            .intent
            .kind
            .strip_prefix("operator:")
            .ok_or("prepared member intent.kind lacks the operator: prefix")?
            .to_string();
        let candidate = if out.parents.is_empty() {
            Candidate::new_root(
                out.object,
                content,
                self.transformation.inputs.clone(),
                &operator,
                &self.transformation.intent.summary,
            )
        } else {
            Candidate::new(
                out.object,
                content,
                out.parents[0].clone(),
                self.transformation.inputs.clone(),
                &operator,
                &self.transformation.intent.summary,
            )
        };
        if candidate.revision != out.revision || candidate.content_hash != out.content_hash {
            return Err("prepared member content does not match its declared hash (tamper)".into());
        }
        if candidate.to_transformation(Agent {
            kind: AgentType::Human,
            id: None,
        }) != self.transformation
        {
            return Err(
                "prepared member transformation is not the canonical one for its candidate".into(),
            );
        }
        Ok(candidate)
    }
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
        // #3c: a super-hub whose incident set is truncated cannot be snapshotted
        // (or committed) on a complete precondition — refuse rather than commit
        // against the first PREVIEW_MAX_EDGES only.
        if inc.truncated {
            return Err("group member is incident to too many edges to commit safely".into());
        }
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
    let earliest_expiry = earliest_expiry(&all_res, &affected)?;
    Ok(GroupSnapshot {
        heads,
        affected_edges: affected.iter().map(|(t, i)| (t.to_string(), *i)).collect(),
        resolution_digest,
        earliest_expiry,
    })
}

/// The earliest `expires` across the resolutions on the affected edges — selected
/// by INSTANT (re-review #4: lexical `.min()` picks the wrong one under mixed
/// offsets), returned normalized to UTC. Fails closed on an unparseable expiry.
fn earliest_expiry(all_res: &ResMap, affected: &[(Uuid, u32)]) -> Result<Option<String>, String> {
    let mut earliest: Option<chrono::DateTime<chrono::Utc>> = None;
    for key in affected {
        let Some(rs) = all_res.get(key) else { continue };
        for r in rs {
            let Some(exp) = &r.expires else { continue };
            let dt = chrono::DateTime::parse_from_rfc3339(exp)
                .map_err(|e| format!("resolution expiry is not rfc3339: {e}"))?
                .with_timezone(&chrono::Utc);
            earliest = Some(earliest.map_or(dt, |cur| cur.min(dt)));
        }
    }
    Ok(earliest.map(|dt| dt.to_rfc3339()))
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

/// Append the durable prepare record — idem folds the attempt_id, so each attempt
/// is a distinct record while an idempotent re-prepare of the same attempt dedupes.
/// Bounds on a group-prepare (re-review #3). Every field a bug or hostile ledger
/// could grow without limit is capped, so a single `group-prepare` ledger line can
/// never exceed what client-less recovery can safely read back into memory. A
/// well-formed Extract-Canon (a carrier + its conformers) is far under every cap;
/// these are fail-closed backstops, not working limits.
const MAX_GROUP_MEMBERS: usize = 256;
const MAX_INPUTS_PER_MEMBER: usize = 512;
/// `intent.kind` + `intent.summary` bytes per member (a short human string).
const MAX_INTENT_BYTES: usize = 8 * 1024;
const MAX_SNAPSHOT_HEADS: usize = 1024;
/// Above the `PREVIEW_MAX_EDGES` (2000) truncation cap, with margin — a truncated
/// affected set is already refused before we reach here.
const MAX_SNAPSHOT_EDGES: usize = 4096;
/// Total serialized bytes — the ultimate bound on the ledger line. Below the
/// ledger's 8 MiB `MAX_SEGMENT_BYTES`, so a prepare line never dominates a segment.
const MAX_PREPARE_BYTES: usize = 4 * 1024 * 1024;

/// Reject an oversized prepare BEFORE it is staged/appended (#3). Called by
/// `append_prepare` (the single write choke point) so no path can bypass it, and
/// by the fresh accept path before CAS staging so a rejected group never orphans
/// content.
pub fn validate_bounds(prepare: &GroupPrepare) -> Result<(), String> {
    // Only UPPER bounds here (#3 is about OOM). Non-emptiness is already
    // guaranteed upstream by `accept_group` (`empty changeset` is rejected before
    // any prepare is built), and lifecycle records legitimately carry no members.
    if prepare.members.len() > MAX_GROUP_MEMBERS {
        return Err(format!(
            "group too large: {} members exceeds the {MAX_GROUP_MEMBERS} cap",
            prepare.members.len()
        ));
    }
    for m in &prepare.members {
        let t = &m.transformation;
        if t.inputs.len() > MAX_INPUTS_PER_MEMBER {
            return Err(format!(
                "group member has {} inputs, exceeds the {MAX_INPUTS_PER_MEMBER} cap",
                t.inputs.len()
            ));
        }
        let intent_bytes = t.intent.kind.len() + t.intent.summary.len();
        if intent_bytes > MAX_INTENT_BYTES {
            return Err(format!(
                "group member intent is {intent_bytes} bytes, exceeds the {MAX_INTENT_BYTES} cap"
            ));
        }
    }
    if prepare.snapshot.heads.len() > MAX_SNAPSHOT_HEADS {
        return Err(format!(
            "group snapshot has {} heads, exceeds the {MAX_SNAPSHOT_HEADS} cap",
            prepare.snapshot.heads.len()
        ));
    }
    if prepare.snapshot.affected_edges.len() > MAX_SNAPSHOT_EDGES {
        return Err(format!(
            "group snapshot has {} affected edges, exceeds the {MAX_SNAPSHOT_EDGES} cap",
            prepare.snapshot.affected_edges.len()
        ));
    }
    let serialized = serde_json::to_string(prepare).map_err(|e| e.to_string())?;
    if serialized.len() > MAX_PREPARE_BYTES {
        return Err(format!(
            "group-prepare is {} bytes, exceeds the {MAX_PREPARE_BYTES} cap",
            serialized.len()
        ));
    }
    Ok(())
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

#[cfg(test)]
#[path = "group_prepare.test.rs"]
mod tests;

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
use super::types::{Agent, AgentType, ObjectId, RevisionId, Transformation};

// Moved out for the file-size split and re-exported, so every existing
// `group_prepare::<name>` path keeps resolving — the relocation is physical,
// not an API change.
pub use super::group_bounds::validate_bounds;
pub use super::group_prepare_ops::{append_abort, append_prepare, find_latest, revalidate};

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

pub(super) fn digest_uuid(domain: &str, payload: &str) -> Uuid {
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

pub(super) fn resolution_digest(all_res: &ResMap, affected: &[(Uuid, u32)]) -> String {
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

#[cfg(test)]
#[path = "group_prepare.test.rs"]
mod tests;

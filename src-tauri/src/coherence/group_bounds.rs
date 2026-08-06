//! Hard bounds on a group-commit prepare record, and the check that enforces
//! them.
//!
//! Split out of `group_prepare.rs` for size. These limits are a trust boundary,
//! not tuning: a prepare record is read back during recovery, so an unbounded
//! one is a denial-of-service against reopening the workspace. Keeping them in
//! one small file makes the whole budget readable at once.
//!
//! @coordinates-with group_prepare.rs — the GroupPrepare record being validated
//! @module coherence/group_bounds

use super::group_prepare::GroupPrepare;

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

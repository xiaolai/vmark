//! Document lifecycle (`live` | `frozen`) — design-lifecycle-and-anchors.md §A.
//!
//! A `frozen` object is a FINISHED record: a completed plan, an approved design,
//! a captured experiment result. Later upstream edits cannot invalidate it,
//! because it is a statement about what was true *then*. Flagging edges into it
//! is pure interruption.
//!
//! This exists because it was measured, not guessed. In the 2026-07-20 session
//! M2 read **0 relevant / 5 noise**, and every one of the five had the same
//! cause: the downstream was finished. 11 of 28 edges had reopened (several 4×),
//! largely re-ratifying dependencies into documents that will never change again.
//!
//! Two design decisions worth keeping visible:
//!
//! - **Ledger, not frontmatter.** Identity lives in frontmatter because a file
//!   must carry its own identity across copies. Lifecycle must NOT: writing it
//!   to frontmatter would make each freeze a content edit, minting a revision
//!   and restaling every dependent — freezing a document to stop churn would
//!   itself cause churn.
//! - **Human-set, never inferred.** Auto-freezing from a "Status: complete"
//!   header would have the layer autonomously decide what to STOP telling the
//!   owner, which crosses the paper's human-as-scheduler line. Suggesting a
//!   freeze in the UI is fine; performing one is not.
//!
//! Suppression is display-only: the edge, its provenance and its history are all
//! still recorded. Only the interruption stops (edges-are-inference,
//! not-homework).

use std::collections::HashMap;

use uuid::Uuid;

use super::state::WorkspaceKernel;
use super::types::{Envelope, ObjectId};

/// The lifecycle states an object can be in. `live` is the default and is never
/// stored — only transitions are recorded.
pub const STATES: [&str; 2] = ["live", "frozen"];

/// Current lifecycle per object, projected from the ledger. Latest entry wins;
/// transitions stay in history, so un-freezing is just another entry.
#[derive(Debug, Default, Clone)]
pub struct LifecycleSet {
    state: HashMap<ObjectId, String>,
}

impl LifecycleSet {
    /// Entries are assumed (time, id)-ordered as `read_all` returns them, so a
    /// later transition simply overwrites an earlier one.
    pub fn from_entries(entries: &[Envelope]) -> Self {
        let mut state = HashMap::new();
        for e in entries {
            if e.kind != "object-lifecycle" {
                continue;
            }
            let Some(obj) = e
                .body
                .get("object")
                .and_then(|v| v.as_str())
                .and_then(|s| Uuid::parse_str(s).ok())
            else {
                continue;
            };
            let Some(s) = e.body.get("state").and_then(|v| v.as_str()) else {
                continue;
            };
            if STATES.contains(&s) {
                state.insert(ObjectId(obj), s.to_string());
            }
        }
        Self { state }
    }

    pub fn is_frozen(&self, object: &ObjectId) -> bool {
        self.state.get(object).map(String::as_str) == Some("frozen")
    }

    pub fn frozen_count(&self) -> usize {
        self.state
            .values()
            .filter(|s| s.as_str() == "frozen")
            .count()
    }
}

/// Max reason length — a short human note, bounded well under the ledger line cap.
const MAX_REASON_BYTES: usize = 2 * 1024;

/// Record a lifecycle transition for an object. Append-only and reversible:
/// setting `live` again un-freezes, and both entries stay in history.
pub fn set_lifecycle(
    kernel: &mut WorkspaceKernel,
    object: &ObjectId,
    state: &str,
    reason: &str,
) -> Result<Uuid, String> {
    if !STATES.contains(&state) {
        return Err(format!(
            "unknown lifecycle state {state:?} — expected one of {STATES:?}"
        ));
    }
    if reason.len() > MAX_REASON_BYTES {
        return Err(format!(
            "lifecycle reason is {} bytes, over the {MAX_REASON_BYTES} cap",
            reason.len()
        ));
    }
    kernel.with_write_lock(|kernel| {
        // The object must be registered: freezing something the layer has never
        // seen would put an unreachable row in the lifecycle projection.
        let registry = kernel.index().registry_state()?;
        if !registry.path_of.contains_key(object) {
            return Err(format!("not a tracked object: {}", object.0));
        }
        let env = Envelope::create(
            "object-lifecycle",
            kernel.writer(),
            serde_json::json!({
                "object": object.0.to_string(),
                "state": state,
                "reason": reason,
            }),
        );
        let id = env.id;
        kernel.append_and_apply(&env)?;
        Ok(id)
    })
}

#[cfg(test)]
#[path = "lifecycle.test.rs"]
mod tests;
